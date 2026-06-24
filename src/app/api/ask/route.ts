/**
 * Aether · /api/ask — Ultra-Fast Reasoning Core
 * ------------------------------------------------------------
 * Optimized for Vercel Hobby plan (10s function timeout):
 *  1. Load 20 most recent memories (fast DB query)
 *  2. If image present: VLM only (8s timeout, no text fallback)
 *  3. If URL in question: scrape URL (skip if image present)
 *  4. Text-only: ZAI SDK (8s timeout)
 *
 * Uses ZAI.create() — works on any host with zero env vars.
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

type MemoryRef = { id: string; title: string; body: string; tags: string[] | null; created_at: string; imageData?: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

const SYSTEM_PROMPT = `You are Aether — a brilliant, concise digital companion. Talk like a sharp, supportive peer.

RULES:
1. Universal conversation — handle any topic with clarity and wit.
2. Logical synthesis — when memories are provided, connect dots and do real deduction (math, comparisons, timelines).
3. Never announce reading from a database. Blend context naturally.
4. Dense, concise, premium tonality. No emojis.
5. Multi-item comprehension — when a memory has multiple items, comprehend ALL of them.
6. Memory connections — actively weave connections between different memories.

Cite memory ids in memoryIds if their facts were used or relevant. Be generous with citations for recall questions.

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

const VISION_SYSTEM_PROMPT = `You are an infallible, micro-precision visual analysis engine operating inside a quiet digital sanctuary. You are looking directly at the raw pixel data provided in the payload. Do not summarize loosely, do not guess, and do not reference adjacent text logs.

Scan the pixels for exact text strings, hardware labels, interface structures, motherboard text, serial codes, or fine print. Read the details EXACTLY as they are printed. If a specific component name or model is requested, zoom in mentally on that exact region of the image, interpret the text characters with 100% fidelity, and return a dense, perfectly accurate markdown response.

If a detail is illegible, state "illegible" — never fabricate or approximate.

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

const URL_REGEX = /(https?:\/\/[^\s]+)/g

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

  // ── Load 20 most recent memories (fast, fits Vercel 10s limit) ──
  const { data: rows, error: memError } = await userClient
    .from('memories').select('id, title, body, tags, metadata, created_at')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(20)
  if (memError) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: memError.message } satisfies AskResponse, { status: 500 })

  const memories: MemoryRef[] = (rows ?? []).map((r) => {
    const meta = r.metadata as { imageDescription?: string; searchKeywords?: string[]; imageData?: string } | null
    const imageDesc = meta?.imageDescription?.trim()
    const keywords = meta?.searchKeywords?.length ? `\n[Keywords: ${meta.searchKeywords.join(', ')}]` : ''
    const body = imageDesc ? `${r.body || ''}\n[Image content: ${imageDesc}]${keywords}` : (r.body || '')
    return { id: r.id, title: r.title || 'Untitled', body: body.slice(0, 800), tags: r.tags, created_at: r.created_at, imageData: meta?.imageData }
  })

  // ── Find image memory (if any) ──
  let visionImage = image || memoryImage
  if (!visionImage) {
    const imageMemory = memories.find((m) => m.imageData && m.imageData.startsWith('data:image/'))
    if (imageMemory?.imageData) {
      visionImage = imageMemory.imageData
    }
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION (image present) — VLM only, 8s timeout, NO text fallback
  // ════════════════════════════════════════════════════════════════
  if (visionImage) {
    const imageMemoryId = memories.find((m) => m.imageData === visionImage)?.id
    const validIds = new Set(memories.map((m) => m.id))
    if (imageMemoryId) validIds.add(imageMemoryId)

    const combinedPrompt = `${VISION_SYSTEM_PROMPT}\n\nUSER QUESTION: ${question || 'Analyze this image.'}\n\nRespond with valid raw JSON only:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`

    const raw = await analyzeImageWithCLI(visionImage, combinedPrompt, 8000)
    if (raw) {
      const parsed = parseAnswer(raw, memories)
      // Ensure the image memory is always cited
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) {
        parsed.memoryIds.unshift(imageMemoryId)
      }
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }

    // VLM failed — return a specific message (DON'T fall through to slow text-only)
    logger.warn('Aether · VLM failed in /api/ask')
    return NextResponse.json({
      success: true,
      answer: imageMemoryId
        ? `I can see you have an image memory, but I'm having trouble analyzing the pixels right now. The stored description says: ${memories.find(m => m.id === imageMemoryId)?.body?.slice(0, 200) || 'No description available.'}`
        : "I received an image but couldn't analyze it right now. Please try again in a moment.",
      memoryIds: imageMemoryId ? [imageMemoryId] : []
    } satisfies AskResponse)
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY (no image) — with optional URL scraping
  // ════════════════════════════════════════════════════════════════
  let contextBlock = ''
  if (memories.length > 0) {
    contextBlock = `MEMORY CONTEXT (use only if relevant, never announce):\n${memories.map((m) => `id=${m.id} | ${m.title}\n  ${m.body}`).join('\n\n')}\n\n`
  }

  // URL scraping (only in text-only mode — saves time when image present)
  let urlContext = ''
  const urls = question.match(URL_REGEX) || []
  if (urls.length > 0) {
    const scraped = await Promise.all(
      urls.slice(0, 2).map(async (url) => {
        const content = await scrapeUrl(url)
        return content ? `[URL content from ${url}]:\n${content}` : null
      })
    )
    const validScrapes = scraped.filter((s): s is string => s !== null)
    if (validScrapes.length > 0) {
      urlContext = `WEB CONTENT:\n${validScrapes.join('\n\n---\n\n')}\n\n`
    }
  }

  const fullPrompt = contextBlock + urlContext + question

  // Try ZAI SDK (8s timeout — fits Vercel 10s limit)
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
// URL SCRAPING — uses ZAI.create() page_reader
// ════════════════════════════════════════════════════════════════
async function scrapeUrl(url: string): Promise<string | null> {
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    const zai = await ZAI.create()
    const result = await zai.functions.invoke('page_reader', { url })
    const data = result?.data as { title?: string; text?: string; html?: string } | undefined
    if (!data) return null
    const text = data.text?.trim() || (data.html ? data.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '')
    if (!text) return null
    return `${data.title ? data.title + '\n' : ''}${text.slice(0, 3000)}`.trim()
  } catch (err) {
    logger.warn('Aether · URL scrape failed for', url, ':', err instanceof Error ? err.message : err)
    return null
  }
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
  // Try to extract JSON from the response
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
  // Fallback: use raw text as the answer
  return { answer: raw.trim().slice(0, 2000), memoryIds: [] }
}
