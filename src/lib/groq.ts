/**
 * Aether · Groq Cloud utility
 * ------------------------------------------------------------
 * NOTE: The provided Groq API key returns 403 Forbidden.
 * This file is kept as a fallback — if the key becomes valid,
 * Groq will be used. Currently the ZAI SDK (vlm.ts) is the primary.
 */

import { logger } from './logger'

const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const VISION_MODEL = 'llama-3.2-11b-vision-preview'
const TEXT_MODEL = 'llama-3.3-70b-versatile'

export async function groqText(
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 7000
): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 800,
      }),
    })

    clearTimeout(timeout)
    if (!res.ok) {
      logger.warn('Aether · Groq text error:', res.status)
      return null
    }

    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : null
  } catch (err) {
    logger.warn('Aether · Groq text failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function groqVision(
  prompt: string,
  imageDataUrl: string,
  timeoutMs = 8000
): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    })

    clearTimeout(timeout)
    if (!res.ok) {
      logger.warn('Aether · Groq vision error:', res.status)
      return ''
    }

    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : ''
  } catch (err) {
    logger.warn('Aether · Groq vision failed:', err instanceof Error ? err.message : err)
    return ''
  }
}

export function stripCodeFences(raw: string): string {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|text|html)?\s*/i, '').replace(/\s*```$/, '')
  }
  return cleaned
}
