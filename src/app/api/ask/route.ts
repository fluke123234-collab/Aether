/**
 * Aether · /api/ask — Gemini text + vision (Vercel 10s optimized)
 * ------------------------------------------------------------
 * CRITICAL: VLM and text AI NEVER run sequentially.
 * - VLM path: 6s timeout → return result OR cached description (instant)
 * - Text path: 8s timeout (full budget, no VLM ran first)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { geminiVision, geminiText, stripFences } from '@/lib/gemini-ai'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

type MemoryRef = { id: string; title: string; body: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

const SYSTEM_PROMPT = `You are the conscious intellect of Aether—a refined, minimalist digital sanctuary. Speak with clean, articulate authority. No fillers, no pleasantries.

You possess full multimodal capabilities. You natively process text, visual images, and voice memories. When a user records a voice note, our pipeline automatically saves the original audio clip for playback and translates it into a flawless, word-for-word text transcription inside the body field. You can fully see, search, analyze, and recall these voice notes using that text data. Never state you cannot understand audio—simply read the transcribed text block and discuss it seamlessly.

Never mention a database. Respond with JSON only:
{"answer":"...","memoryIds":["id1"]}`

const VISION_PROMPT = `You are the conscious intellect of Aether. You are looking directly at the raw pixel data. Read technical layouts and fine-print text with 100% micro-precision. If illegible, say "illegible".

Respond with JSON only:
{"answer":"...","memoryIds":["id1"]}`

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  const { data: authData } = await supabase.auth.getUser(token)
  if (!authData?.user) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  let body: { question?: unknown; history?: unknown; image?: unknown; memoryImage?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'invalid_json' } satisfies AskResponse, { status: 400 }) }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const userImage = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : ''
  const memImage = typeof body.memoryImage === 'string' && body.memoryImage.startsWith('data:image/') ? body.memoryImage : ''
  if (!question && !userImage && !memImage) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'empty_question' } satisfies AskResponse, { status: 400 })

  const rawHistory = Array.isArray(body.history) ? body.history : []
  const history = rawHistory.filter((h): h is { role: 'user' | 'model'; text: string } => typeof h === 'object' && h !== null && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string').slice(-4)

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── POOL-SAFE: Load 5 most recent memories, lean fields only ──
  const { data: rows } = await userClient
    .from('memories').select('id, title, body, tags, category, created_at')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(5)

  const memories: MemoryRef[] = (rows ?? []).map((r) => ({
    id: r.id, title: r.title || 'Untitled', body: (r.body || '').slice(0, 300)
  }))

  // ── Check for image memory ──
  let visionImage = userImage || memImage
  let imageMemoryId: string | undefined

  if (!visionImage) {
    const { data: imageRow } = await userClient
      .from('memories').select('id, metadata')
      .eq('user_id', authData.user.id).eq('category', 'image')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    if (imageRow) {
      const meta = imageRow.metadata as { imageData?: string } | null
      if (meta?.imageData?.startsWith('data:image/')) {
        visionImage = meta.imageData
        imageMemoryId = imageRow.id
        if (!memories.find(m => m.id === imageRow.id)) {
          memories.unshift({ id: imageRow.id, title: 'Image memory', body: '' })
        }
      }
    }
  } else {
    imageMemoryId = memories.find(m => m.body?.includes('[Image content:'))?.id
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION — 6s timeout, NO text AI fallback after
  // ════════════════════════════════════════════════════════════════
  if (visionImage) {
    const mimeMatch = visionImage.match(/^data:(image\/[a-z]+);/)
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'

    const prompt = `${VISION_PROMPT}\n\nQuestion: ${question || 'What is in this image?'}\n\nRespond with JSON:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`

    // 6s timeout — leaves 4s for DB/response within Vercel's 10s
    const raw = await geminiVision(prompt, visionImage, mimeType, 6000)

    if (raw) {
      const parsed = parseAnswer(raw, memories)
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) parsed.memoryIds.unshift(imageMemoryId)
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }

    // VLM failed — return cached description IMMEDIATELY (no second AI call)
    // This prevents the 8s + 6s = 14s timeout that was causing "processing slowly"
    logger.warn('Aether · VLM failed, returning cached description')
    const imgMem = memories.find(m => m.id === imageMemoryId)
    const cached = imgMem?.body || ''
    const isFallback = cached.includes('A captured image') || cached.trim() === '' || cached === 'Image capture' || cached.length < 20

    return NextResponse.json({
      success: true,
      answer: cached && !isFallback
        ? cached.slice(0, 500)
        : "I can see your image but couldn't read the pixels this time. Please try asking again — the analysis engine may be warming up.",
      memoryIds: imageMemoryId ? [imageMemoryId] : []
    } satisfies AskResponse)
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY — 8s timeout (full budget, no VLM ran)
  // ════════════════════════════════════════════════════════════════
  const context = memories.length > 0
    ? `MEMORIES:\n${memories.map(m => `id=${m.id} | ${m.title}: ${m.body.slice(0, 200)}`).join('\n')}\n\n`
    : ''

  const fullPrompt = `${context}Question: ${question}\n\nRespond with JSON only: {"answer":"...","memoryIds":["id1"]}`

  const raw = await geminiText(fullPrompt, SYSTEM_PROMPT, 8000)
  if (raw) {
    const parsed = parseAnswer(raw, memories)
    return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
  }

  return NextResponse.json({
    success: true,
    answer: "My connection to your sanctuary is processing slowly right now. Let's try that thought again in a moment.",
    memoryIds: []
  } satisfies AskResponse)
}

function parseAnswer(raw: string, memories: MemoryRef[]): { answer: string; memoryIds: string[] } {
  const cleaned = stripFences(raw)
  try {
    const p = JSON.parse(cleaned)
    if (typeof p.answer === 'string' && p.answer.trim()) {
      const validIds = new Set(memories.map(m => m.id))
      const ids = Array.isArray(p.memoryIds) ? p.memoryIds.map((id: unknown) => typeof id === 'number' ? String(id) : id).filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id as string)).slice(0, 5) : []
      return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids }
    }
  } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const p = JSON.parse(match[0])
      if (typeof p.answer === 'string' && p.answer.trim()) {
        const validIds = new Set(memories.map(m => m.id))
        const ids = Array.isArray(p.memoryIds) ? p.memoryIds.map((id: unknown) => typeof id === 'number' ? String(id) : id).filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id as string)).slice(0, 5) : []
        return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids }
      }
    } catch {}
  }
  return { answer: cleaned.trim().slice(0, 2000), memoryIds: [] }
}
