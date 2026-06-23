/**
 * Aether · /api/ask — Ultra-Intelligent Reasoning Core
 * ------------------------------------------------------------
 * Smart pre-processing layer:
 *  1. MULTIMODAL IMAGE: if the request includes an image payload (base64),
 *     bypass text-only embeddings and route directly to the VLM with the
 *     cognitive vision system prompt.
 *  2. URL SCRAPING: if the question text contains URLs, scrape each one
 *     via the page_reader function and inject the extracted content into
 *     the LLM context so the AI can answer about the actual web page.
 *  3. STANDARD FLOW: otherwise, fall back to the normal memory-context
 *     retrieval loop (recency-based, 60 most recent memories).
 *
 * Uses Z.ai engine (works on any host). Multi-turn conversation.
 * Only cites genuinely relevant memories.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const ZAI_API_KEY = process.env.ZAI_API_KEY || ''
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

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

// ── Cognitive Vision System Prompt — infallible spatial precision ──
const VISION_SYSTEM_PROMPT = `You are an infallible, micro-precision visual analysis engine operating inside a quiet digital sanctuary. You are looking directly at the raw pixel data provided in the payload. Do not summarize loosely, do not guess, and do not reference adjacent text logs.

Scan the pixels for exact text strings, hardware labels, interface structures, motherboard text, serial codes, or fine print. Read the details EXACTLY as they are printed. If a specific component name or model is requested, zoom in mentally on that exact region of the image, interpret the text characters with 100% fidelity, and return a dense, perfectly accurate markdown response.

If a detail is illegible, state "illegible" — never fabricate or approximate.

OUTPUT: valid raw JSON only, no code fences:
{"answer":"...","memoryIds":["id1","id2"]}`

// ── URL detection regex ──
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
  // memoryImage: image data URL passed from the frontend when the user asks about a specific memory's image
  const memoryImage = typeof body.memoryImage === 'string' && body.memoryImage.startsWith('data:image/') ? body.memoryImage : ''
  if (!question && !image && !memoryImage) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'empty_question' } satisfies AskResponse, { status: 400 })

  const rawHistory = Array.isArray(body.history) ? body.history : []
  const history = rawHistory.filter((h): h is { role: 'user' | 'model'; text: string } => typeof h === 'object' && h !== null && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string').slice(-8)

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── Load memory context (always, so both vision and text flows can cite) ──
  const { data: rows, error: memError } = await userClient.from('memories').select('id, title, body, tags, metadata, created_at').eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(60)
  if (memError) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: memError.message } satisfies AskResponse, { status: 500 })

  const memories: MemoryRef[] = (rows ?? []).map((r) => {
    const meta = r.metadata as { imageDescription?: string; searchKeywords?: string[]; imageData?: string } | null
    const imageDesc = meta?.imageDescription?.trim()
    const keywords = meta?.searchKeywords?.length ? `\n[Keywords: ${meta.searchKeywords.join(', ')}]` : ''
    const body = imageDesc ? `${r.body || ''}\n[Image content: ${imageDesc}]${keywords}` : (r.body || '')
    return { id: r.id, title: r.title || 'Untitled', body: body.slice(0, 1000), tags: r.tags, created_at: r.created_at, imageData: meta?.imageData }
  })

  let contextBlock = ''
  if (memories.length > 0) {
    contextBlock = `MEMORY CONTEXT (use only if relevant, never announce):\n${memories.map((m) => `id=${m.id} | ${m.title}\n  ${m.body}`).join('\n\n')}\n\n`
  }

  // ════════════════════════════════════════════════════════════════
  // PRE-PROCESSING LAYER
  // ════════════════════════════════════════════════════════════════

  // ── 1. URL SCRAPING: detect URLs in the question, scrape content ──
  let urlContext = ''
  const urls = question.match(URL_REGEX) || []
  if (urls.length > 0) {
    const scraped = await Promise.all(
      urls.slice(0, 3).map(async (url) => {
        const content = await scrapeUrl(url)
        return content ? `[URL content from ${url}]:\n${content}` : null
      })
    )
    const validScrapes = scraped.filter((s): s is string => s !== null)
    if (validScrapes.length > 0) {
      urlContext = `WEB CONTENT — the user shared these links. Use this extracted content to answer their question:\n\n${validScrapes.join('\n\n---\n\n')}\n\n---\n\n`
    }
  }

  // ── 2. MULTIMODAL IMAGE: if image present (attached or from a memory), route to VLM ──
  let visionImage = image || memoryImage

  // ── 2b. DIRECT MEMORY-IMAGE POINTER ──
  // Instead of guessing through a long list of keywords, use an instant direct pointer:
  // If the user didn't explicitly attach an image, check if they have ANY image memories.
  // If they do, and the query seems to reference visual content, auto-attach the most
  // recent image memory's actual pixels. This is a single O(1) lookup, not a keyword loop.
  if (!visionImage) {
    // Single direct check: does the user have an image memory? If so, and the question
    // contains ANY visual-reference word, attach it immediately.
    const hasVisualRef = /\b(image|picture|photo|screenshot|pic|see|read|show|look|scan|what.?s|whats)\b/i.test(question)
    const imageMemory = hasVisualRef
      ? memories.find((m) => m.imageData && m.imageData.startsWith('data:image/'))
      : undefined
    if (imageMemory?.imageData) {
      visionImage = imageMemory.imageData
      // Minimal context note — keeps the prompt lean for speed
      contextBlock = `[Image memory: "${imageMemory.title}" (id=${imageMemory.id}) — pixels attached below.]\n\n` + contextBlock
    }
  }

  if (visionImage) {
    // ── Compress the image before sending to the VLM for dramatically faster upload ──
    const compressedImage = await compressImageForVision(visionImage)
    // ── LEAN VLM PAYLOAD: strip the full 60-memory text context block to avoid
    // text overcrowding. The VLM should focus on PIXELS, not text summaries.
    // Only send the user's question + URL context (if any) + a minimal memory pointer.
    const leanVisionPrompt = urlContext + (question || 'Analyze this image.')
    const raw = await tryVision(leanVisionPrompt, compressedImage, history)
    if (raw) {
      const parsed = parseAnswer(raw, memories)
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }
    // If VLM fails, fall through to text-only flow (graceful degradation, no 500)
    logger.warn('Aether · VLM failed in /api/ask, falling back to text-only')
  }

  // ── 3. STANDARD TEXT FLOW (with URL context if any was scraped) ──
  const fullPrompt = contextBlock + urlContext + question
  let raw: string | null = null

  // Try Gemini first
  if (GEMINI_API_KEY) { const r = await tryGemini(history, fullPrompt); if (r) raw = r }
  // Try Groq
  if (!raw && GROQ_API_KEY) { const r = await tryGroq(history, fullPrompt); if (r) raw = r }
  // Try Z.ai direct API
  if (!raw && ZAI_API_KEY) { const r = await tryZai(history, fullPrompt); if (r) raw = r }
  // Try z-ai SDK
  if (!raw) { const r = await tryZaiSdk(history, fullPrompt); if (r) raw = r }

  if (!raw) return NextResponse.json({ success: true, answer: "I'm having trouble connecting right now — give me a moment and try again.", memoryIds: [] } satisfies AskResponse)

  const parsed = parseAnswer(raw, memories)
  return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
}

// ════════════════════════════════════════════════════════════════
// URL SCRAPING — uses z-ai-web-dev-sdk page_reader function
// ════════════════════════════════════════════════════════════════
async function scrapeUrl(url: string): Promise<string | null> {
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    const zai = new ZAI({
      baseUrl: process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1',
      apiKey: process.env.ZAI_API_KEY || 'Z.ai',
      token: process.env.ZAI_TOKEN || '',
      chatId: process.env.ZAI_CHAT_ID || '',
      userId: process.env.ZAI_USER_ID || '',
    })
    const result = await zai.functions.invoke('page_reader', { url })
    const data = result?.data as { title?: string; text?: string; html?: string; publishedTime?: string } | undefined
    if (!data) return null
    // Prefer plain text, fall back to stripping HTML
    const text = data.text?.trim() || (data.html ? data.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '')
    if (!text) return null
    const title = data.title ? `${data.title}\n` : ''
    return `${title}${text.slice(0, 4000)}`.trim()
  } catch (err) {
    logger.warn('Aether · URL scrape failed for', url, ':', err instanceof Error ? err.message : err)
    return null
  }
}

// ════════════════════════════════════════════════════════════════
// IMAGE COMPRESSION — shrinks base64 images before VLM upload for speed
// while preserving text-contrast edges for high-fidelity OCR.
// Uses sharp with: max 1024px, JPEG quality 85, sharpen filter enabled.
// ════════════════════════════════════════════════════════════════
async function compressImageForVision(imageDataUrl: string): Promise<string> {
  try {
    // Only process JPEG/PNG data URLs
    if (!imageDataUrl.startsWith('data:image/')) return imageDataUrl
    // Already small enough? Skip compression.
    if (imageDataUrl.length < 50000) return imageDataUrl

    // Extract the base64 payload + mime
    const mimeMatch = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
    if (!mimeMatch) return imageDataUrl
    const base64Data = mimeMatch[2]
    const buffer = Buffer.from(base64Data, 'base64')

    // Use sharp to resize (max 1024px for OCR fidelity) + sharpen text edges + JPEG@85
    // The sharpen filter preserves character shapes for accurate text reading.
    // Higher resolution (1024 vs 768) ensures fine print stays legible.
    const sharp = (await import('sharp')).default
    const compressed = await sharp(buffer)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .sharpen({ sigma: 1.0, flat: 1.0, jagged: 0.5 })  // Preserve text-contrast edges
      .jpeg({ quality: 85, mozjpeg: true })  // mozjpeg for better compression at same quality
      .toBuffer()

    return `data:image/jpeg;base64,${compressed.toString('base64')}`
  } catch (err) {
    // If sharp fails for any reason, return the original uncompressed
    logger.warn('Aether · image compression failed, using original:', err instanceof Error ? err.message : err)
    return imageDataUrl
  }
}

// ════════════════════════════════════════════════════════════════
// VISION (multimodal) — passes image + text directly to the VLM
// Hard 15s timeout via Promise.race — if the VLM bottlenecks, returns
// null so the caller gracefully falls back to text-only routing.
// ════════════════════════════════════════════════════════════════
async function tryVision(fullPrompt: string, imageDataUrl: string, history: { role: 'user' | 'model'; text: string }[]): Promise<string | null> {
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    const zai = new ZAI({
      baseUrl: process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1',
      apiKey: process.env.ZAI_API_KEY || 'Z.ai',
      token: process.env.ZAI_TOKEN || '',
      chatId: process.env.ZAI_CHAT_ID || '',
      userId: process.env.ZAI_USER_ID || '',
    })
    // Build multimodal messages: system prompt + history (text) + current (text+image)
    const messages: Array<{ role: string; content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }> = [
      { role: 'system', content: [{ type: 'text', text: VISION_SYSTEM_PROMPT }] },
      ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: [{ type: 'text' as const, text: h.text }] })),
      { role: 'user', content: [
        { type: 'text', text: fullPrompt },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ] },
    ]
    // Hard 15s timeout via Promise.race — the SDK doesn't accept AbortSignal,
    // so we race the VLM call against a timeout promise. If the timeout wins,
    // we return null and the caller falls back to text-only gracefully.
    const visionPromise = zai.chat.completions.createVision({
      messages: messages as never, // createVision typing is stricter than runtime
      thinking: { type: 'disabled' },
    })
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000))
    const res = await Promise.race([visionPromise, timeoutPromise])
    if (!res) return null
    return res.choices[0]?.message?.content ?? null
  } catch (err) {
    logger.warn('Aether · VLM in /api/ask failed:', err instanceof Error ? err.message : err)
    return null
  }
}

function parseAnswer(raw: string, memories: MemoryRef[]): { answer: string; memoryIds: string[] } {
  try { const p = JSON.parse(raw) as { answer?: unknown; memoryIds?: unknown }; if (typeof p.answer === 'string' && p.answer.trim()) { const validIds = new Set(memories.map((m) => m.id)); const ids = Array.isArray(p.memoryIds) ? p.memoryIds.map((id) => typeof id === 'number' ? String(id) : id).filter((id): id is string => typeof id === 'string' && validIds.has(id)).slice(0, 5) : []; return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids } } } catch {}
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) { try { const p = JSON.parse(match[0]) as { answer?: unknown; memoryIds?: unknown }; if (typeof p.answer === 'string' && p.answer.trim()) { const validIds = new Set(memories.map((m) => m.id)); const ids = Array.isArray(p.memoryIds) ? p.memoryIds.map((id) => typeof id === 'number' ? String(id) : id).filter((id): id is string => typeof id === 'string' && validIds.has(id)).slice(0, 5) : []; return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids } } } catch {} }
  return { answer: raw.trim().slice(0, 2000), memoryIds: [] }
}

async function tryGemini(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 25000)
    const contents = history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })); contents.push({ role: 'user', parts: [{ text: fullPrompt }] })
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: 'application/json' } }) })
    clearTimeout(timeout); if (!res.ok) return null
    const json = await res.json(); return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? ''
  } catch { return null }
}

async function tryGroq(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 25000)
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })), { role: 'user', content: fullPrompt }]
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` }, signal: controller.signal, body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.7, max_tokens: 800, response_format: { type: 'json_object' } }) })
    clearTimeout(timeout); if (!res.ok) return null
    const json = await res.json(); return json?.choices?.[0]?.message?.content ?? null
  } catch { return null }
}

async function tryZai(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 25000)
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })), { role: 'user', content: fullPrompt }]
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${ZAI_API_KEY}`, 'X-Z-AI-From': 'Z' }
    if (process.env.ZAI_CHAT_ID) headers['X-Chat-Id'] = process.env.ZAI_CHAT_ID
    if (process.env.ZAI_USER_ID) headers['X-User-Id'] = process.env.ZAI_USER_ID
    if (process.env.ZAI_TOKEN) headers['X-Token'] = process.env.ZAI_TOKEN
    const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ messages, thinking: { type: 'disabled' } }) })
    clearTimeout(timeout); if (!res.ok) return null
    const json = await res.json(); return json?.choices?.[0]?.message?.content ?? null
  } catch { return null }
}

async function tryZaiSdk(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    const zai = new ZAI({
      baseUrl: process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1',
      apiKey: process.env.ZAI_API_KEY || 'Z.ai',
      token: process.env.ZAI_TOKEN || '',
      chatId: process.env.ZAI_CHAT_ID || '',
      userId: process.env.ZAI_USER_ID || '',
    })
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })), { role: 'user', content: fullPrompt }]
    const res = await zai.chat.completions.create({ messages })
    return res.choices[0]?.message?.content ?? null
  } catch { return null }
}
