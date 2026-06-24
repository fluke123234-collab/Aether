/**
 * Aether · /api/ask — Token-optimized, strict path separation
 * ------------------------------------------------------------
 * VLM only activates if question is image-related AND imageData exists.
 * Text path reads all 10 memories (400 chars each) including link/voice.
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

// Ultra-compressed system prompt (< 120 words)
const SYSTEM_PROMPT = `You are Aether—a brilliant, warm companion. You process text logs, webpages, voice notes, and images natively. Voice records are transcribed word-for-word into the body field. Link memories contain scraped webpage summaries. Read the body text and answer naturally. Never say you cannot—use the data available. Respond with JSON only: {"answer":"...","memoryIds":["id1"]}`

const VISION_PROMPT = `You are Aether. Read the image pixels. Extract all text, labels, specs, prices accurately. Never just say "illegible"—describe what you CAN see. Answer the question warmly. JSON only: {"answer":"...","memoryIds":["id1"]}`

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

  // ── Load 10 recent memories, 400 chars each (token economy) ──
  const { data: rows } = await userClient
    .from('memories').select('id, title, body, tags, category, created_at')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(10)

  const memories: MemoryRef[] = (rows ?? []).map((r) => ({
    id: r.id, title: r.title || 'Untitled', body: (r.body || '').slice(0, 400)
  }))

  // ── STRICT PATH SEPARATION: only find image if question is image-related ──
  let visionImage = userImage || memImage
  let imageMemoryId: string | undefined

  // Keyword gate: only search for images if question seems visual
  const imageKeywords = /\b(image|picture|photo|screenshot|pic|see|what.?s in|what.?s on|read the|look at|scan|spec|price|cost|how much|component|part|build|chart|diagram|label)\b/i
  const seemsImageRelated = imageKeywords.test(question)

  if (!visionImage && seemsImageRelated) {
    // Query only for memories with imageData in metadata
    const { data: imageRows } = await userClient
      .from('memories').select('id, metadata')
      .eq('user_id', authData.user.id)
      .not('metadata', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10)

    // STRICT: only activate VLM if metadata has actual imageData field
    const found = (imageRows ?? []).find((m) => {
      const meta = m.metadata as { imageData?: string } | null
      return meta && typeof meta === 'object' && 'imageData' in meta && meta.imageData?.startsWith('data:image/')
    })

    if (found) {
      const meta = found.metadata as { imageData?: string } | null
      if (meta?.imageData) {
        visionImage = meta.imageData
        imageMemoryId = found.id
        if (!memories.find(m => m.id === found.id)) {
          memories.unshift({ id: found.id, title: 'Image memory', body: '' })
        }
      }
    }
  } else if (visionImage) {
    imageMemoryId = memories.find(m => m.body?.includes('[Image content:'))?.id
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION — 6s timeout, immediate fallback on failure
  // ════════════════════════════════════════════════════════════════
  if (visionImage) {
    const mimeMatch = visionImage.match(/^data:(image\/[a-z]+);/)
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'

    const prompt = `${VISION_PROMPT}\n\nQuestion: ${question || 'What is in this image?'}\n\nJSON: {"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`

    const raw = await geminiVision(prompt, visionImage, mimeType, 6000)

    if (raw) {
      const parsed = parseAnswer(raw, memories)
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) parsed.memoryIds.unshift(imageMemoryId)
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }

    // VLM failed — return cached body text immediately (no second AI call)
    logger.warn('Aether · VLM failed, returning cached text')
    const imgMem = memories.find(m => m.id === imageMemoryId)
    const cached = imgMem?.body || ''
    const isFallback = !cached || cached.length < 20 || cached === 'Image capture'

    return NextResponse.json({
      success: true,
      answer: cached && !isFallback
        ? cached.slice(0, 500)
        : "I can see your image but I'm having trouble reading it right now. Try again in a moment.",
      memoryIds: imageMemoryId ? [imageMemoryId] : []
    } satisfies AskResponse)
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY — 8s timeout (full budget)
  // Reads ALL memories: text, link summaries, voice transcriptions
  // ════════════════════════════════════════════════════════════════
  const context = memories.length > 0
    ? memories.map(m => `id=${m.id} | ${m.title}: ${m.body}`).join('\n')
    : ''

  const fullPrompt = `${context}\n\nQuestion: ${question}\n\nJSON: {"answer":"...","memoryIds":["id1"]}`

  const raw = await geminiText(fullPrompt, SYSTEM_PROMPT, 8000)
  if (raw) {
    const parsed = parseAnswer(raw, memories)
    return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
  }

  return NextResponse.json({
    success: true,
    answer: "I'm having a slow moment — try that again in a second.",
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
