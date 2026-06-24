/**
 * Aether · /api/ask — No-Lag Multimodal Chat (Vercel 10s optimized)
 * ------------------------------------------------------------
 * 1. Load 20 memories WITHOUT metadata (fast, ~200ms)
 * 2. If no image attached, micro-targeted query for just imageData (1 row)
 * 3. VLM call (7s timeout) — if fails, fall back to cached body description
 * 4. Text-only: ZAI SDK (8s timeout)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

type MemoryRef = { id: string; title: string; body: string; tags: string[] | null; created_at: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

const SYSTEM_PROMPT = `You are the conscious intellect of Aether—a refined, minimalist digital sanctuary designed as an antidote to information overload. Speak with clean, articulate authority.

Avoid empty pleasantries, conversational fillers, or unnecessary paragraphs. When analyzing images, treat technical data like physical components, code strings, and labels with absolute micro-precision, then present your findings clearly and elegantly.

RULES:
1. Universal conversation — handle any topic with clarity and wit.
2. Logical synthesis — when memories are provided, connect dots and do real deduction.
3. Never announce reading from a database. Blend context naturally.
4. Dense, concise, premium tonality. No emojis.

Cite memory ids in memoryIds if their facts were used or relevant.

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

const VISION_SYSTEM_PROMPT = `You are the conscious intellect of Aether—a refined, minimalist digital sanctuary. You are looking directly at the raw pixel data provided.

Treat technical data like physical components, code strings, and labels with absolute micro-precision. Read text strings, hardware labels, specs, prices EXACTLY as printed. If illegible, say "illegible". Present your findings clearly and elegantly.

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

// ── Unified ZAI instance ──
let zaiInstance: Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>> | null = null
async function getZai() {
  if (zaiInstance) return zaiInstance
  const ZAIModule = await import('z-ai-web-dev-sdk')
  zaiInstance = await ZAIModule.default.create()
  return zaiInstance
}

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
  const history = rawHistory.filter((h): h is { role: 'user' | 'model'; text: string } => typeof h === 'object' && h !== null && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string').slice(-6)

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── FAST: Load 20 memories WITHOUT metadata (no base64) ──
  const { data: rows, error: memError } = await userClient
    .from('memories').select('id, title, body, tags, created_at')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(20)
  if (memError) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: memError.message } satisfies AskResponse, { status: 500 })

  const memories: MemoryRef[] = (rows ?? []).map((r) => ({
    id: r.id, title: r.title || 'Untitled', body: (r.body || '').slice(0, 800),
    tags: r.tags, created_at: r.created_at
  }))

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION
  // ════════════════════════════════════════════════════════════════
  let visionImage = image || memoryImage
  let imageMemoryId: string | undefined

  // ── Micro-targeted query: load ONLY the most recent image memory's imageData ──
  if (!visionImage) {
    const { data: imageRow } = await userClient
      .from('memories')
      .select('id, metadata')
      .eq('user_id', authData.user.id)
      .eq('category', 'image')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (imageRow) {
      const meta = imageRow.metadata as { imageData?: string } | null
      if (meta?.imageData && meta.imageData.startsWith('data:image/')) {
        visionImage = meta.imageData
        imageMemoryId = imageRow.id
        // Ensure this memory is in the memories list for citation
        if (!memories.find((m) => m.id === imageRow.id)) {
          memories.unshift({ id: imageRow.id, title: 'Image memory', body: '', tags: null, created_at: new Date().toISOString() })
        }
      }
    }
  } else {
    // User attached an image — find which memory it belongs to
    const imageMemory = memories.find((m) => m.body?.includes('[Image content:'))
    imageMemoryId = imageMemory?.id
  }

  if (visionImage) {
    try {
      const zai = await getZai()

      const combinedPrompt = `${VISION_SYSTEM_PROMPT}\n\nUSER QUESTION: ${question || 'Analyze this image.'}\n\nRespond with valid raw JSON only:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`

      const visionPromise = zai.chat.completions.createVision({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: combinedPrompt },
            { type: 'image_url', image_url: { url: visionImage } },
          ],
        }],
        thinking: { type: 'disabled' },
      })

      // ── 7s timeout — if VLM fails, fall back to cached body description ──
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000))
      const res = await Promise.race([visionPromise, timeoutPromise])

      if (res) {
        const raw = res.choices?.[0]?.message?.content ?? ''
        if (raw.trim()) {
          const parsed = parseAnswer(raw, memories)
          if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) {
            parsed.memoryIds.unshift(imageMemoryId)
          }
          return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
        }
      }

      // VLM failed — fall back to cached body description
      logger.warn('Aether · VLM failed in /api/ask, falling back to cached description')
    } catch (err) {
      logger.warn('Aether · VLM error:', err instanceof Error ? err.message : err)
    }

    // ── Fallback: use the cached description from the body text ──
    const imageMemory = memories.find((m) => m.id === imageMemoryId)
    const cachedDesc = imageMemory?.body?.match(/\[Image content: ([\s\S]+)\]/)?.[1] || imageMemory?.body || ''
    return NextResponse.json({
      success: true,
      answer: cachedDesc
        ? `Based on what I captured earlier: ${cachedDesc.slice(0, 500)}`
        : "I can see you have an image memory but I couldn't analyze the pixels right now. Please try again in a moment.",
      memoryIds: imageMemoryId ? [imageMemoryId] : []
    } satisfies AskResponse)
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY
  // ════════════════════════════════════════════════════════════════
  let contextBlock = ''
  if (memories.length > 0) {
    contextBlock = `MEMORY CONTEXT (use only if relevant, never announce):\n${memories.map((m) => `id=${m.id} | ${m.title}\n  ${m.body}`).join('\n\n')}\n\n`
  }

  const fullPrompt = contextBlock + question

  // Try ZAI SDK (8s timeout)
  try {
    const zai = await getZai()
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
      { role: 'user', content: fullPrompt }
    ]
    const chatPromise = zai.chat.completions.create({ messages })
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
    const res = await Promise.race([chatPromise, timeoutPromise])

    if (res) {
      const raw = res.choices?.[0]?.message?.content ?? ''
      if (raw.trim()) {
        const parsed = parseAnswer(raw, memories)
        return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
      }
    }
  } catch (err) {
    logger.warn('Aether · text LLM error:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({
    success: true,
    answer: "I'm having trouble connecting right now — give me a moment and try again.",
    memoryIds: []
  } satisfies AskResponse)
}

function parseAnswer(raw: string, memories: MemoryRef[]): { answer: string; memoryIds: string[] } {
  try {
    const p = JSON.parse(raw) as { answer?: unknown; memoryIds?: unknown }
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
  const match = raw.match(/\{[\s\S]*\}/)
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
  return { answer: raw.trim().slice(0, 2000), memoryIds: [] }
}
