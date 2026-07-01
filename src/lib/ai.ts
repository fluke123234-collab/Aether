/**
 * Aether · Unified AI layer — Groq primary, Gemini fallback
 * Multi-key rotation + dead-key cache (5-min auto-retry)
 */

import { logger } from './logger'

// ── Groq config (multi-key rotation) ──
const GROQ_BASE = 'https://api.groq.com/openai/v1'
const GROQ_TEXT_MODEL = process.env.GROQ_TEXT_MODEL || 'llama-3.3-70b-versatile'
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct'
const GROQ_AUDIO_MODEL = process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3'

// Collect all Groq keys (GROQ_API_KEY, GROQ_API_KEY_2, ...)
const GROQ_KEYS: string[] = Object.entries(process.env)
  .filter(([k]) => k.startsWith('GROQ_API_KEY'))
  .sort()
  .map(([, v]) => v)
  .filter((v): v is string => !!v && v.length > 10)

// ── Gemini config ──
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// ── Dead-key cache (time-limited: retries after 5 minutes) ──
const DEAD_RETRY_MS = 5 * 60 * 1000
const groqKeyDeadAt: Record<number, number> = {}
let geminiDeadAt = 0
function isGroqKeyDead(idx: number) { return groqKeyDeadAt[idx] > 0 && Date.now() - groqKeyDeadAt[idx] < DEAD_RETRY_MS }
function markGroqKeyDead(idx: number) { groqKeyDeadAt[idx] = Date.now() }
function isGeminiDead() { return geminiDeadAt > 0 && Date.now() - geminiDeadAt < DEAD_RETRY_MS }
function markGeminiDead() { geminiDeadAt = Date.now() }

/* ═══ TEXT ═══ */
export async function groqChat(
  messages: ChatMessage[],
  opts?: { jsonMode?: boolean; timeoutMs?: number; maxTokens?: number; temperature?: number }
): Promise<string | null> {
  const timeoutMs = opts?.timeoutMs ?? 5000
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    if (isGroqKeyDead(i)) continue
    const result = await tryGroqChat(messages, opts, timeoutMs, GROQ_KEYS[i], i)
    if (result) return result
  }
  if (GEMINI_API_KEY && !isGeminiDead()) {
    const result = await tryGeminiText(messages, opts, timeoutMs)
    if (result) return result
  }
  logger.warn('Aether · All text AI providers failed')
  return null
}

async function tryGroqChat(messages: ChatMessage[], opts: { jsonMode?: boolean; maxTokens?: number; temperature?: number } | undefined, timeoutMs: number, apiKey: string, keyIndex: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body: Record<string, unknown> = { model: GROQ_TEXT_MODEL, messages, temperature: opts?.temperature ?? 0.7, max_tokens: opts?.maxTokens ?? 600 }
    if (opts?.jsonMode) body.response_format = { type: 'json_object' }
    const res = await fetch(`${GROQ_BASE}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, signal: controller.signal, body: JSON.stringify(body) })
    clearTimeout(timer)
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · Groq text key${keyIndex} ${res.status}: ${errText.slice(0, 80)}`)
      if (res.status === 401 || res.status === 403 || res.status === 429) markGroqKeyDead(keyIndex)
      return null
    }
    const json = await res.json()
    return json?.choices?.[0]?.message?.content ?? null
  } catch (err) { clearTimeout(timer); logger.warn('Aether · Groq text failed:', err instanceof Error ? err.message.slice(0, 80) : err); return null }
}

async function tryGeminiText(messages: ChatMessage[], opts: { jsonMode?: boolean; maxTokens?: number; temperature?: number } | undefined, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const systemMsg = messages.find(m => m.role === 'system')
    const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const body: Record<string, unknown> = { contents, generationConfig: { temperature: opts?.temperature ?? 0.7, maxOutputTokens: opts?.maxTokens ?? 600, ...(opts?.jsonMode ? { responseMimeType: 'application/json' } : {}) } }
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] }
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) })
    clearTimeout(timer)
    if (!res.ok) { const errText = await res.text().catch(() => ''); logger.warn(`Aether · Gemini text ${res.status}: ${errText.slice(0, 80)}`); if (res.status === 401 || res.status === 403 || res.status === 429) markGeminiDead(); return null }
    const json = await res.json()
    return json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? null
  } catch (err) { clearTimeout(timer); logger.warn('Aether · Gemini text failed:', err instanceof Error ? err.message.slice(0, 80) : err); return null }
}

/* ═══ VISION ═══ */
export async function groqVision(prompt: string, imageDataUrl: string, opts?: { timeoutMs?: number }): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 5000
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    if (isGroqKeyDead(i)) continue
    const result = await tryGroqVision(prompt, imageDataUrl, timeoutMs, GROQ_KEYS[i], i)
    if (result) return result
  }
  if (GEMINI_API_KEY && !isGeminiDead()) {
    const result = await tryGeminiVision(prompt, imageDataUrl, timeoutMs)
    if (result) return result
  }
  logger.warn('Aether · All vision providers failed')
  return ''
}

async function tryGroqVision(prompt: string, imageDataUrl: string, timeoutMs: number, apiKey: string, keyIndex: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${GROQ_BASE}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, signal: controller.signal, body: JSON.stringify({ model: GROQ_VISION_MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl } }] }], temperature: 0.3, max_tokens: 800 }) })
    clearTimeout(timer)
    if (!res.ok) { const errText = await res.text().catch(() => ''); logger.warn(`Aether · Groq vision key${keyIndex} ${res.status}: ${errText.slice(0, 80)}`); if (res.status === 401 || res.status === 403 || res.status === 429) markGroqKeyDead(keyIndex); return '' }
    const json = await res.json()
    return json?.choices?.[0]?.message?.content ?? ''
  } catch (err) { clearTimeout(timer); logger.warn('Aether · Groq vision failed:', err instanceof Error ? err.message.slice(0, 80) : err); return '' }
}

async function tryGeminiVision(prompt: string, imageDataUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const match = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
    if (!match) return ''
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: match[2], mimeType: match[1] } }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 800 } }) })
    clearTimeout(timer)
    if (!res.ok) { const errText = await res.text().catch(() => ''); logger.warn(`Aether · Gemini vision ${res.status}: ${errText.slice(0, 80)}`); if (res.status === 401 || res.status === 403 || res.status === 429) markGeminiDead(); return '' }
    const json = await res.json()
    return json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? ''
  } catch (err) { clearTimeout(timer); logger.warn('Aether · Gemini vision failed:', err instanceof Error ? err.message.slice(0, 80) : err); return '' }
}

/* ═══ AUDIO ═══ */
export async function groqTranscribe(audioDataUrl: string, opts?: { timeoutMs?: number }): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 5000
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    if (isGroqKeyDead(i)) continue
    const result = await tryGroqWhisper(audioDataUrl, timeoutMs, GROQ_KEYS[i], i)
    if (result) return result
  }
  if (GEMINI_API_KEY && !isGeminiDead()) {
    const result = await tryGeminiAudio(audioDataUrl, timeoutMs)
    if (result) return result
  }
  logger.warn('Aether · All transcription providers failed')
  return ''
}

async function tryGroqWhisper(audioDataUrl: string, timeoutMs: number, apiKey: string, keyIndex: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const match = audioDataUrl.match(/^data:(audio\/[a-z]+);base64,(.+)$/)
    if (!match) return ''
    const mimeType = match[1]; const buffer = Buffer.from(match[2], 'base64')
    const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'webm'
    const formData = new FormData()
    formData.append('file', new Blob([buffer], { type: mimeType }), `audio.${ext}`)
    formData.append('model', GROQ_AUDIO_MODEL); formData.append('response_format', 'text'); formData.append('language', 'en')
    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: formData, signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) { const errText = await res.text().catch(() => ''); logger.warn(`Aether · Groq transcription key${keyIndex} ${res.status}: ${errText.slice(0, 80)}`); if (res.status === 401 || res.status === 403 || res.status === 429) markGroqKeyDead(keyIndex); return '' }
    return (await res.text()).trim()
  } catch (err) { clearTimeout(timer); logger.warn('Aether · Groq transcription failed:', err instanceof Error ? err.message.slice(0, 80) : err); return '' }
}

async function tryGeminiAudio(audioDataUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const match = audioDataUrl.match(/^data:(audio\/[a-z]+);base64,(.+)$/)
    if (!match) return ''
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Transcribe this audio word-for-word. Output ONLY the transcription.' }, { inlineData: { data: match[2], mimeType: match[1] } }] }], generationConfig: { temperature: 0.0, maxOutputTokens: 800 } }) })
    clearTimeout(timer)
    if (!res.ok) { const errText = await res.text().catch(() => ''); logger.warn(`Aether · Gemini audio ${res.status}: ${errText.slice(0, 80)}`); if (res.status === 401 || res.status === 403 || res.status === 429) markGeminiDead(); return '' }
    const json = await res.json()
    return json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? ''
  } catch (err) { clearTimeout(timer); logger.warn('Aether · Gemini audio failed:', err instanceof Error ? err.message.slice(0, 80) : err); return '' }
}

/* ═══ HELPERS ═══ */
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
  const stopwords = new Set(['what','have','been','thinking','about','your','were','they','from','will','would','could','should','tell','show','find','give','know','think','want','need','this','that','with','just','like','when','which','there','their','more','some','than','very','into','only','also','does','done','made','make','patterns','notice'])
  const q = question.toLowerCase()
  const keywords = (q.match(/\b[a-z]{4,}\b/g) || []).filter(w => !stopwords.has(w))
  const scored = memories.map(m => { const t = (m.title||'').toLowerCase(), b = (m.body||'').toLowerCase(); let s = 0; for (const kw of keywords) { if (t.includes(kw)) s += 3; if (b.includes(kw)) s += 1 } return { memory: m, score: s } })
  scored.sort((a, b) => b.score - a.score)
  const top = scored.filter(s => s.score > 0).slice(0, 3)
  if (top.length > 0) { const ids = top.map(s => s.memory.id); const parts = top.map((s, i) => `${i+1}. ${s.memory.title}: ${(s.memory.body||'').slice(0,200)}`); return { answer: `Here's what I found:\n\n${parts.join('\n\n')}`, memoryIds: ids } }
  const recent = memories.slice(0, 3); const ids = recent.map(m => m.id); const parts = recent.map((m, i) => `${i+1}. ${m.title}: ${(m.body||'').slice(0,200)}`)
  return { answer: `Here are your most recent memories:\n\n${parts.join('\n\n')}`, memoryIds: ids }
}
