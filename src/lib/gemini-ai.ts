/**
 * Aether · AI utility — Gemini first, Z.ai proxy fallback
 * ------------------------------------------------------------
 * Tries Google Gemini (gemini-2.0-flash) first.
 * If Gemini fails (quota, timeout, etc.), falls back to the Z.ai proxy
 * running on this container (which CAN reach internal-api.z.ai).
 * 
 * Both paths work on Vercel — Gemini is a public API, and the proxy
 * is reachable via its public URL.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { logger } from './logger'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const MODEL_NAME = 'gemini-2.0-flash'

// Z.ai proxy fallback (running on this container)
const ZAI_PROXY_URL = 'https://preview-chat-29bf48db-839a-48ab-a402-026a1fd7cc19.space-z.ai/?XTransformPort=3001'

let geminiInstance: GoogleGenerativeAI | null = null
function getGemini() {
  if (!GEMINI_API_KEY) return null
  if (geminiInstance) return geminiInstance
  geminiInstance = new GoogleGenerativeAI(GEMINI_API_KEY)
  return geminiInstance
}

/**
 * Text completion — tries Gemini, falls back to Z.ai proxy.
 */
export async function geminiText(
  prompt: string,
  systemPrompt?: string,
  timeoutMs = 6000
): Promise<string | null> {
  // ── Try Gemini first ──
  const ai = getGemini()
  if (ai) {
    try {
      const model = ai.getGenerativeModel({
        model: MODEL_NAME,
        ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
      })
      const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), timeoutMs))
      const result = await Promise.race([model.generateContent(prompt), timeoutPromise])
      if (result) {
        const text = result.response.text().trim()
        if (text) return text
      }
    } catch (err) {
      logger.warn('Aether · Gemini text failed, trying proxy:', err instanceof Error ? err.message.slice(0, 80) : err)
    }
  }

  // ── Fallback: Z.ai proxy ──
  try {
    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }]

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(ZAI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ type: 'text', messages, timeoutMs: timeoutMs - 1000 }),
    })
    clearTimeout(timeout)
    if (res.ok) {
      const json = await res.json()
      if (json.success && json.content) return json.content
    }
  } catch (err) {
    logger.warn('Aether · Z.ai proxy text failed:', err instanceof Error ? err.message.slice(0, 80) : err)
  }

  return null
}

/**
 * Vision analysis — tries Gemini, falls back to Z.ai proxy.
 */
export async function geminiVision(
  prompt: string,
  base64Data: string,
  mimeType: string,
  timeoutMs = 8000
): Promise<string> {
  // ── Try Gemini first ──
  const ai = getGemini()
  if (ai) {
    try {
      const model = ai.getGenerativeModel({ model: MODEL_NAME })
      const base64 = base64Data.startsWith('data:') ? base64Data.split(',')[1] : base64Data
      const imagePart = { inlineData: { data: base64, mimeType: mimeType || 'image/jpeg' } }
      const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), timeoutMs))
      const result = await Promise.race([model.generateContent([prompt, imagePart]), timeoutPromise])
      if (result) {
        const text = result.response.text().trim()
        if (text) return text
      }
    } catch (err) {
      logger.warn('Aether · Gemini vision failed, trying proxy:', err instanceof Error ? err.message.slice(0, 80) : err)
    }
  }

  // ── Fallback: Z.ai proxy ──
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(ZAI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ type: 'vision', prompt, image: base64Data, timeoutMs: timeoutMs - 1000 }),
    })
    clearTimeout(timeout)
    if (res.ok) {
      const json = await res.json()
      if (json.success && json.content) return json.content
    }
  } catch (err) {
    logger.warn('Aether · Z.ai proxy vision failed:', err instanceof Error ? err.message.slice(0, 80) : err)
  }

  return ''
}

/**
 * Strip markdown code fences.
 */
export function stripFences(raw: string): string {
  let c = raw.trim()
  if (c.startsWith('```')) c = c.replace(/^```(?:json|text|html)?\s*/i, '').replace(/\s*```$/, '')
  return c
}
