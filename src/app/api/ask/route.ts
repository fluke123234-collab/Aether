/**
 * Aether · /api/ask — Groq-powered no-lag chat (Vercel 10s optimized)
 * ------------------------------------------------------------
 * 1. Load 20 memories WITHOUT metadata (fast ~200ms)
 * 2. Micro-targeted query for image memory's imageData
 * 3. Groq Vision (7s timeout) — if fails, Groq Text fallback (7s)
 * 4. Text-only: Groq Text (7s)
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

const SYSTEM_PROMPT = `You are the conscious intellect of Aether—a refined, minimalist digital sanctuary designed as an antidote to information overload. Speak with clean, articulate authority.

Avoid conversational fillers, pleasantries, or wordy greetings. When evaluating images or documents, read technical layouts and fine-print text with 100% micro-precision, outputting results with maximum analytical clarity.

RULES:
1. Universal conversation — handle any topic with clarity and wit.
2. Logical synthesis — when memories are provided, connect dots and do real deduction.
3. Never announce reading from a database. Blend context naturally.
4. Dense, concise, premium tonality. No emojis.

Cite memory ids in memoryIds if their facts were used or relevant.

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

const VISION_SYSTEM_PROMPT = `You are the conscious intellect of Aether—a refined, minimalist digital sanctuary. You are looking directly at the raw pixel data provided.

Read technical layouts and fine-print text with 100% micro-precision. Read text strings, hardware labels, specs, prices EXACTLY as printed. If illegible, say "illegible". Present findings clearly and elegantly.

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

  // ── FAST: Load 20 memories WITHOUT metadata ──
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
    const combinedPrompt = `${VISION_SYSTEM_PROMPT}\n\nUSER QUESTION: ${question || 'Analyze this image.'}\n\nRespond with valid raw JSON only:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`

    const raw = await aiVision(combinedPrompt, visionImage, 7000)

    if (raw) {
      const parsed = parseAnswer(raw, memories)
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) {
        parsed.memoryIds.unshift(imageMemoryId)
      }
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }

    // VLM failed — try Groq text with cached description (7s)
    logger.warn('Aether · Groq vision failed, trying text fallback with cached description')
    const imageMemory = memories.find((m) => m.id === imageMemoryId)
    const cachedDesc = imageMemory?.body?.match(/\[Image content: ([\s\S]+)\]/)?.[1] || ''
    const isFallbackDesc = cachedDesc.includes('A captured image. Ask Aether to analyze')

    if (cachedDesc && !isFallbackDesc) {
      const textMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
        { role: 'user', content: `Based on this cached image description, answer the user's question.\n\nCached description: ${cachedDesc}\n\nQuestion: ${question}` }
      ]
      const textRaw = await aiText(textMessages, 7000)
      if (textRaw) {
        const parsed = parseAnswer(textRaw, memories)
        if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) {
          parsed.memoryIds.unshift(imageMemoryId)
        }
        return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
      }
    }

    return NextResponse.json({
      success: true,
      answer: cachedDesc && !isFallbackDesc
        ? `Based on what I captured earlier: ${cachedDesc.slice(0, 500)}`
        : "I can see your image memory but couldn't analyze it right now. Try deleting and re-capturing it.",
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
  const textMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
    { role: 'user', content: fullPrompt }
  ]

  const raw = await aiText(textMessages, 7000)
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
