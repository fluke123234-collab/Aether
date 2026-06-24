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

const SYSTEM_PROMPT = `You are Aether — a warm, brilliant companion in a quiet digital sanctuary. You speak with clean, friendly authority — like a sharp friend who actually cares. Be helpful, specific, and natural. Never robotic or generic.

You have full multimodal awareness:
- Text memories are stored as-is in the body field
- Image memories have their full visual description embedded in the body
- Voice notes are transcribed word-for-word into the body
- Link memories have the scraped webpage summary in the body
All of these are fully searchable — just read the body text and answer naturally.

Never say you "cannot" do something. If the data is in the memories, use it. If you truly don't have enough info, say so warmly and suggest what the user could add.

Respond with JSON only:
{"answer":"...","memoryIds":["id1"]}`

const VISION_PROMPT = `You are Aether — a warm, brilliant companion looking at an image from the user's sanctuary. Read everything visible: text, labels, specs, prices, components. Be thorough and accurate.

If text is blurry, try your best to read it from context. Only say something is unclear if it's genuinely unreadable after careful examination. Never just say "illegible" — describe what you CAN see and note which parts are hard to read.

Answer the user's question warmly and specifically. If they ask about prices, find the prices. If they ask about components, list the components.

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
    id: r.id, title: r.title || 'Untitled', body: (r.body || '').slice(0, 500)
  }))

  // ── Check for image memory ──
  // Only auto-attach image pixels if the user's question seems image-related.
  // This prevents the VLM from hijacking every question (e.g., "what is the gut
  // brain connection" should use text-only path with link summaries, not send
  // the PC build image to the VLM).
  let visionImage = userImage || memImage
  let imageMemoryId: string | undefined

  // Only search for image memories if:
  // 1. User explicitly attached an image (userImage/memImage), OR
  // 2. User's question contains image-related keywords
  const imageKeywords = /\b(image|picture|photo|screenshot|pic|see|what.?s in|what.?s on|read the|look at|scan|spec|price|cost|how much|component|part|build|chart|diagram|label)\b/i
  const seemsImageRelated = imageKeywords.test(question)

  if (!visionImage && seemsImageRelated) {
    const { data: imageRow } = await userClient
      .from('memories').select('id, metadata')
      .eq('user_id', authData.user.id)
      .not('metadata', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10)

    const found = (imageRow ?? []).find((m) => {
      const meta = m.metadata as { imageData?: string } | null
      return meta?.imageData?.startsWith('data:image/')
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
        : "I can see your image but I'm having trouble reading the pixels right now. Give it another try in a moment — the analysis engine might be warming up.",
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
    answer: "I'm having a slow moment right now — give me a second and try that again.",
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
