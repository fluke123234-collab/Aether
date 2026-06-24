/**
 * Aether · /api/ask — Fast Reasoning Core (Vercel 10s optimized)
 * ------------------------------------------------------------
 * KEY OPTIMIZATION: Don't load metadata (which includes base64 imageData)
 * in the main memory query. Instead, do a SEPARATE targeted query for
 * just the image memory's imageData when needed. This saves hundreds of KB
 * of data transfer and several seconds.
 *
 * Flow:
 *  1. Load 20 memories WITHOUT metadata (fast: ~200ms)
 *  2. If any memory has an image, do a targeted query for JUST that imageData
 *  3. Pass image to VLM (7s timeout)
 *  4. If no image: text-only with ZAI SDK (8s timeout)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { analyzeImageWithCLI } from '@/lib/vlm'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

type MemoryRef = { id: string; title: string; body: string; tags: string[] | null; created_at: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

const SYSTEM_PROMPT = `You are Aether — a brilliant, concise digital companion. Talk like a sharp, supportive peer.

RULES:
1. Universal conversation — handle any topic with clarity and wit.
2. Logical synthesis — when memories are provided, connect dots and do real deduction (math, comparisons, timelines).
3. Never announce reading from a database. Blend context naturally.
4. Dense, concise, premium tonality. No emojis.
5. Multi-item comprehension — when a memory has multiple items, comprehend ALL of them.
6. Memory connections — actively weave connections between different memories.

Cite memory ids in memoryIds if their facts were used or relevant.

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

const VISION_SYSTEM_PROMPT = `You are an infallible, micro-precision visual analysis engine. You are looking directly at the raw pixel data. Do not guess. Read text strings, hardware labels, specs, prices EXACTLY as printed. If illegible, say "illegible". Return a dense, accurate response.

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
  const history = rawHistory.filter((h): h is { role: 'user' | 'model'; text: string } => typeof h === 'object' && h !== null && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string').slice(-6)

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── FAST: Load 20 memories WITHOUT metadata (no base64 imageData) ──
  const { data: rows, error: memError } = await userClient
    .from('memories').select('id, title, body, tags, created_at')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(20)
  if (memError) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: memError.message } satisfies AskResponse, { status: 500 })

  const memories: MemoryRef[] = (rows ?? []).map((r) => ({
    id: r.id, title: r.title || 'Untitled', body: (r.body || '').slice(0, 800),
    tags: r.tags, created_at: r.created_at
  }))

  // ── Build context block ──
  let contextBlock = ''
  if (memories.length > 0) {
    contextBlock = `MEMORY CONTEXT (use only if relevant, never announce):\n${memories.map((m) => `id=${m.id} | ${m.title}\n  ${m.body}`).join('\n\n')}\n\n`
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION — user attached an image OR sent a memoryImage
  // ════════════════════════════════════════════════════════════════
  let visionImage = image || memoryImage

  // ── If no image attached, check if the user has an image memory ──
  // Query ONLY for the most recent image memory's metadata (not all memories)
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
        // Add this memory to the memories list for citation
        if (!memories.find((m) => m.id === imageRow.id)) {
          memories.unshift({ id: imageRow.id, title: 'Image memory', body: '', tags: null, created_at: new Date().toISOString() })
        }
      }
    }
  }

  if (visionImage) {
    // Find the image memory's ID for citation
    const imageMemory = memories.find((m) => m.title === 'Image capture' || m.body?.includes('[Image content:'))
    const imageMemoryId = imageMemory?.id

    const combinedPrompt = `${VISION_SYSTEM_PROMPT}\n\nUSER QUESTION: ${question || 'Analyze this image.'}\n\nRespond with valid raw JSON only:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`

    const raw = await analyzeImageWithCLI(visionImage, combinedPrompt, 7000)
    if (raw) {
      const parsed = parseAnswer(raw, memories)
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) {
        parsed.memoryIds.unshift(imageMemoryId)
      }
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }

    // VLM failed — return the stored description if available
    logger.warn('Aether · VLM failed in /api/ask')
    const storedDesc = imageMemory?.body || 'No description available.'
    return NextResponse.json({
      success: true,
      answer: `I can see your image memory but I'm having trouble reading the pixels right now. Here's what I know about it: ${storedDesc.slice(0, 300)}`,
      memoryIds: imageMemoryId ? [imageMemoryId] : []
    } satisfies AskResponse)
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY
  // ════════════════════════════════════════════════════════════════
  const fullPrompt = contextBlock + question

  // Try ZAI SDK (8s timeout)
  const raw = await tryZaiSdk(history, fullPrompt)

  if (!raw) {
    return NextResponse.json({
      success: true,
      answer: "I'm having trouble connecting right now — give me a moment and try again.",
      memoryIds: []
    } satisfies AskResponse)
  }

  const parsed = parseAnswer(raw, memories)
  return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
}

// ════════════════════════════════════════════════════════════════
// TEXT-ONLY LLM — ZAI.create() with 8s timeout
// ════════════════════════════════════════════════════════════════
async function tryZaiSdk(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    const zai = await ZAI.create()
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
      { role: 'user', content: fullPrompt }
    ]
    const chatPromise = zai.chat.completions.create({ messages })
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
    const res = await Promise.race([chatPromise, timeoutPromise])
    if (!res) return null
    return res.choices?.[0]?.message?.content ?? null
  } catch { return null }
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
