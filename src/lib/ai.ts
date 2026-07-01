/**
 * Aether · Unified AI layer — Groq primary, Gemini fallback
 * ------------------------------------------------------------
 * Tries Groq first (fastest). If Groq fails, falls back to Gemini.
 * Both providers handle all three modalities via public endpoints:
 *
 *   Groq:
 *     • Text   → llama-3.3-70b-versatile
 *     • Vision → llama-4-scout-17b-16e-instruct
 *     • Audio  → whisper-large-v3
 *
 *   Gemini (gemini-2.0-flash):
 *     • Text   → generateContent with text parts
 *     • Vision → generateContent with inlineData image
 *     • Audio  → generateContent with inlineData audio
 *
 * Every endpoint is a public URL that works on Vercel, localhost, or any host.
 */

import { logger } from './logger'

// ── Groq config ──
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_BASE = 'https://api.groq.com/openai/v1'
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile'
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'
const GROQ_AUDIO_MODEL = process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3'

// ── Gemini config ──
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/* ════════════════════════════════════════════════════════════════
 *  TEXT — chat completions
 * ════════════════════════════════════════════════════════════════ */
export async function groqChat(
  messages: ChatMessage[],
  opts?: {
    jsonMode?: boolean
    timeoutMs?: number
    maxTokens?: number
    temperature?: number
  }
): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 12000

  // ── Try Groq first ──
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const result = await tryGroqChat(messages, opts, timeoutMs)
    if (result) return result
  }

  // ── Fall back to Gemini ──
  if (GEMINI_API_KEY) {
    const result = await tryGeminiText(messages, opts, timeoutMs)
    if (result) return result
  }

  logger.warn('Aether · All text AI providers failed')
  return null
}

async function tryGroqChat(
  messages: ChatMessage[],
  opts: { jsonMode?: boolean; maxTokens?: number; temperature?: number } | undefined,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body: Record<string, unknown> = {
      model: GROQ_TEXT_MODEL,
      messages,
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 1024,
    }
    if (opts?.jsonMode) body.response_format = { type: 'json_object' }

    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      signal: controller.signal,
      body: JSON.stringify(body),
    })
    clearTimeout(timer)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · Groq text ${res.status}: ${errText.slice(0, 100)}`)
      return null
    }
    const json = await res.json()
    return json?.choices?.[0]?.message?.content ?? null
  } catch (err) {
    clearTimeout(timer)
    logger.warn('Aether · Groq text failed:', err instanceof Error ? err.message.slice(0, 80) : err)
    return null
  }
}

async function tryGeminiText(
  messages: ChatMessage[],
  opts: { jsonMode?: boolean; maxTokens?: number; temperature?: number } | undefined,
  timeoutMs: number
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // Convert OpenAI-style messages → Gemini contents
    const systemMsg = messages.find(m => m.role === 'system')
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts?.temperature ?? 0.7,
        maxOutputTokens: opts?.maxTokens ?? 1024,
        ...(opts?.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    }
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] }

    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    })
    clearTimeout(timer)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · Gemini text ${res.status}: ${errText.slice(0, 100)}`)
      return null
    }
    const json = await res.json()
    return json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? null
  } catch (err) {
    clearTimeout(timer)
    logger.warn('Aether · Gemini text failed:', err instanceof Error ? err.message.slice(0, 80) : err)
    return null
  }
}

/* ════════════════════════════════════════════════════════════════
 *  VISION — image analysis
 * ════════════════════════════════════════════════════════════════ */
export async function groqVision(
  prompt: string,
  imageDataUrl: string,
  opts?: { timeoutMs?: number }
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 12000

  // ── Try Groq first ──
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const result = await tryGroqVision(prompt, imageDataUrl, timeoutMs)
    if (result) return result
  }

  // ── Fall back to Gemini ──
  if (GEMINI_API_KEY) {
    const result = await tryGeminiVision(prompt, imageDataUrl, timeoutMs)
    if (result) return result
  }

  logger.warn('Aether · All vision providers failed')
  return ''
}

async function tryGroqVision(prompt: string, imageDataUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
        temperature: 0.3,
        max_tokens: 800,
      }),
    })
    clearTimeout(timer)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · Groq vision ${res.status}: ${errText.slice(0, 100)}`)
      return ''
    }
    const json = await res.json()
    return json?.choices?.[0]?.message?.content ?? ''
  } catch (err) {
    clearTimeout(timer)
    logger.warn('Aether · Groq vision failed:', err instanceof Error ? err.message.slice(0, 80) : err)
    return ''
  }
}

async function tryGeminiVision(prompt: string, imageDataUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const match = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
    if (!match) return ''
    const mimeType = match[1]
    const base64 = match[2]

    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { data: base64, mimeType } },
          ],
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
      }),
    })
    clearTimeout(timer)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · Gemini vision ${res.status}: ${errText.slice(0, 100)}`)
      return ''
    }
    const json = await res.json()
    return json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? ''
  } catch (err) {
    clearTimeout(timer)
    logger.warn('Aether · Gemini vision failed:', err instanceof Error ? err.message.slice(0, 80) : err)
    return ''
  }
}

/* ════════════════════════════════════════════════════════════════
 *  AUDIO — transcription
 *  Groq: Whisper via /audio/transcriptions
 *  Gemini: generateContent with inlineData audio (native)
 * ════════════════════════════════════════════════════════════════ */
export async function groqTranscribe(
  audioDataUrl: string,
  opts?: { timeoutMs?: number }
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 12000

  // ── Try Groq Whisper first ──
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const result = await tryGroqWhisper(audioDataUrl, timeoutMs)
    if (result) return result
  }

  // ── Fall back to Gemini audio ──
  if (GEMINI_API_KEY) {
    const result = await tryGeminiAudio(audioDataUrl, timeoutMs)
    if (result) return result
  }

  logger.warn('Aether · All transcription providers failed')
  return ''
}

async function tryGroqWhisper(audioDataUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const match = audioDataUrl.match(/^data:(audio\/[a-z]+);base64,(.+)$/)
    if (!match) return ''
    const mimeType = match[1]
    const base64 = match[2]
    const buffer = Buffer.from(base64, 'base64')
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mp3') ? 'mp3' : 'webm'

    const formData = new FormData()
    formData.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`)
    formData.append('model', GROQ_AUDIO_MODEL)
    formData.append('response_format', 'text')
    formData.append('language', 'en')

    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: formData,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · Groq transcription ${res.status}: ${errText.slice(0, 100)}`)
      return ''
    }
    return (await res.text()).trim()
  } catch (err) {
    clearTimeout(timer)
    logger.warn('Aether · Groq transcription failed:', err instanceof Error ? err.message.slice(0, 80) : err)
    return ''
  }
}

async function tryGeminiAudio(audioDataUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const match = audioDataUrl.match(/^data:(audio\/[a-z]+);base64,(.+)$/)
    if (!match) return ''
    const mimeType = match[1]
    const base64 = match[2]

    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: 'Transcribe this audio clip word-for-word. Output ONLY the transcription, no labels, no formatting.' },
            { inlineData: { data: base64, mimeType } },
          ],
        }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 800 },
      }),
    })
    clearTimeout(timer)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · Gemini audio ${res.status}: ${errText.slice(0, 100)}`)
      return ''
    }
    const json = await res.json()
    return json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? ''
  } catch (err) {
    clearTimeout(timer)
    logger.warn('Aether · Gemini audio failed:', err instanceof Error ? err.message.slice(0, 80) : err)
    return ''
  }
}

/* ────────────────────────────────────────────────────────────
 *  Helper — strip markdown code fences from AI output
 * ──────────────────────────────────────────────────────────── */
export function stripFences(raw: string): string {
  let c = raw.trim()
  c = c.replace(/^```(?:json|text|html|markdown|md)?\s*/i, '')
  c = c.replace(/\s*```\s*$/i, '')
  c = c.replace(/```(?:json|text|html|markdown|md)?\s*/gi, '')
  c = c.replace(/(?<![a-zA-Z0-9])`([^`\n]+)`(?![a-zA-Z0-9])/g, '$1')
  return c.trim()
}

// LOCAL FALLBACK — Smart memory search (zero API keys needed)
export type LocalMemory = { id: string; title: string; body: string }

export function localMemorySearch(question: string, memories: LocalMemory[]): { answer: string; memoryIds: string[] } {
  if (memories.length === 0) return { answer: "I don't have any memories from you yet. Capture a thought and I'll be able to help.", memoryIds: [] }
  const stopwords = new Set(['what','have','been','thinking','about','your','were','they','from','will','would','could','should','tell','show','find','give','know','think','want','need','this','that','with','just','like','when','which','there','their','more','some','than','very','into','only','also','does','done','made','make'])
  const q = question.toLowerCase()
  const keywords = (q.match(/\b[a-z]{4,}\b/g) || []).filter(w => !stopwords.has(w))
  const scored = memories.map(m => { const t = (m.title||'').toLowerCase(), b = (m.body||'').toLowerCase(); let s = 0; for (const kw of keywords) { if (t.includes(kw)) s += 3; if (b.includes(kw)) s += 1 } return { memory: m, score: s } })
  scored.sort((a, b) => b.score - a.score)
  const top = scored.filter(s => s.score > 0).slice(0, 3)
  if (top.length > 0) { const ids = top.map(s => s.memory.id); const parts = top.map((s, i) => `${i+1}. ${s.memory.title}: ${(s.memory.body||'').slice(0,200)}`); return { answer: `Here's what I found:\n\n${parts.join('\n\n')}`, memoryIds: ids } }
  const recent = memories.slice(0, 3); const ids = recent.map(m => m.id); const parts = recent.map((m, i) => `${i+1}. ${m.title}: ${(m.body||'').slice(0,200)}`)
  return { answer: `Here are your most recent memories:\n\n${parts.join('\n\n')}`, memoryIds: ids }
}
