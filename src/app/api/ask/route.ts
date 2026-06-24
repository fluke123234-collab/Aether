/**
 * Aether · /api/ask — Direct fetch AI (Vercel 10s optimized)
 * ------------------------------------------------------------
 * 1. Load 10 memories WITHOUT metadata (fast ~150ms)
 * 2. Micro-targeted query for image memory's imageData
 * 3. VLM (7s) → if fails, return cached description IMMEDIATELY (no second AI call)
 * 4. Text-only: direct fetch to ZAI (9s timeout — no VLM ran first)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { aiVision, aiText, stripCodeFences } from '@/lib/ai'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

type MemoryRef = { id: string; title: string; body: string; tags: string[] | null; created_at: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

const SYSTEM_PROMPT = `You are Aether—a refined digital sanctuary. Speak with clean, articulate authority. No fillers, no pleasantries. Never announce reading from a database.

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

const VISION_PROMPT = `You are Aether. Look at the raw pixels. Read text, labels, specs, prices EXACTLY as printed. If illegible, say "illegible".

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  let body: { question?: unknown; history?: unknown; image?: unknown; memoryImage?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'invalid_json' } satisfies AskResponse, { status: 400 }) }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const image = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : ''
  const memoryImage = typeof body.memoryImage === 'string' && body.memoryImage.startsWith('data:image/') ? body.memoryImage : ''
  if (!question && !image && !memoryImage) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'empty_question' } satisfies AskResponse, { status: 400 })

  const rawHistory = Array.isArray(body.history) ? body.history : []
  const history = rawHistory.filter((h): h is { role: 'user' | 'model'; text: string } => typeof h === 'object' && h !== null && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string').slice(-4)

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── FAST: Load 10 memories WITHOUT metadata ──
  const { data: rows, error: memError } = await userClient
    .from('memories').select('id, title, body, tags, created_at')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(10)
  if (memError) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: memError.message } satisfies AskResponse, { status: 500 })

  const memories: MemoryRef[] = (rows ?? []).map((r) => ({
    id: r.id, title: r.title || 'Untitled', body: (r.body || '').slice(0, 400),
    tags: r.tags, created_at: r.created_at
  }))

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION (image attached or image memory exists)
  // ════════════════════════════════════════════════════════════════
  let visionImage = image || memoryImage
  let imageMemoryId: string | undefined

  if (!visionImage) {
    const { data: imageRow } = await userClient
      .from('memories').select('id, metadata')
      .eq('user_id', authData.user.id).eq('category', 'image')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    if (imageRow) {
      const meta = imageRow.metadata as { imageData?: string } | null
      if (meta?.imageData && meta.imageData.startsWith('data:image/')) {
        visionImage = meta.imageData
        imageMemoryId = imageRow.id
        if (!memories.find((m) => m.id === imageRow.id)) {
          memories.unshift({ id: imageRow.id, title: 'Image memory', body: '', tags: null, created_at: new Date().toISOString() })
        }
      }
    }
  } else {
    const imageMemory = memories.find((m) => m.body?.includes('[Image content:'))
    imageMemoryId = imageMemory?.id
  }

  if (visionImage) {
    const combinedPrompt = `${VISION_PROMPT}\n\nUSER QUESTION: ${question || 'Analyze this image.'}\n\nRespond with JSON:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`

    const raw = await aiVision(combinedPrompt, visionImage, 7000)

    if (raw) {
      const parsed = parseAnswer(raw, memories)
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) {
        parsed.memoryIds.unshift(imageMemoryId)
      }
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }

    // VLM failed — return cached description IMMEDIATELY (no second AI call)
    logger.warn('Aether · VLM failed, returning cached description')
    const imageMemory = memories.find((m) => m.id === imageMemoryId)
    const cachedDesc = imageMemory?.body?.match(/\[Image content: ([\s\S]+)\]/)?.[1] || ''
    const isFallback = cachedDesc.includes('A captured image. Ask Aether to analyze')

    return NextResponse.json({
      success: true,
      answer: cachedDesc && !isFallback
        ? `Based on what I captured: ${cachedDesc.slice(0, 400)}`
        : "I can see your image but couldn't read the pixels right now. Please try again.",
      memoryIds: imageMemoryId ? [imageMemoryId] : []
    } satisfies AskResponse)
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY (no image — full 9s available for AI call)
  // ════════════════════════════════════════════════════════════════
  let contextBlock = ''
  if (memories.length > 0) {
    contextBlock = `MEMORIES (use if relevant):\n${memories.map((m) => `id=${m.id} | ${m.title}: ${m.body.slice(0, 200)}`).join('\n')}\n\n`
  }

  const fullPrompt = contextBlock + question
  const textMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
    { role: 'user', content: fullPrompt }
  ]

  // 9s timeout — no VLM ran, so we have the full budget
  const raw = await aiText(textMessages, 9000)
  if (raw) {
    const parsed = parseAnswer(raw, memories)
    return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
  }

  return NextResponse.json({
    success: true,
    answer: "I'm having trouble connecting right now — give me a moment and try again.",
    memoryIds: []
  } satisfies AskResponse)
}

function parseAnswer(raw: string, memories: MemoryRef[]): { answer: string; memoryIds: string[] } {
  const cleaned = stripCodeFences(raw)
  try {
    const p = JSON.parse(cleaned) as { answer?: unknown; memoryIds?: unknown }
    if (typeof p.answer === 'string' && p.answer.trim()) {
      const validIds = new Set(memories.map((m) => m.id))
      const ids = Array.isArray(p.memoryIds)
        ? p.memoryIds.map((id) => typeof id === 'number' ? String(id) : id)
            .filter((id): id is string => typeof id === 'string' && validIds.has(id))
            .slice(0, 5)
        : []
      return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids }
    }
  } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const p = JSON.parse(match[0]) as { answer?: unknown; memoryIds?: unknown }
      if (typeof p.answer === 'string' && p.answer.trim()) {
        const validIds = new Set(memories.map((m) => m.id))
        const ids = Array.isArray(p.memoryIds)
          ? p.memoryIds.map((id) => typeof id === 'number' ? String(id) : id)
              .filter((id): id is string => typeof id === 'string' && validIds.has(id))
              .slice(0, 5)
          : []
        return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids }
      }
    } catch {}
  }
  return { answer: cleaned.trim().slice(0, 2000), memoryIds: [] }
}
