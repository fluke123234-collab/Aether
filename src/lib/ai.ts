/**
 * Aether · AI utility — direct fetch to ZAI API (NO SDK)
 * ------------------------------------------------------------
 * Bypasses the z-ai-web-dev-sdk entirely. Uses direct fetch() with
 * hardcoded credentials as headers. This is the most reliable approach
 * for Vercel serverless — no SDK initialization, no module loading,
 * no file system lookups, no config parsing.
 *
 * Text endpoint:  POST https://internal-api.z.ai/v1/chat/completions
 * Vision endpoint: POST https://internal-api.z.ai/v1/chat/completions/vision
 */

import { logger } from './logger'

const ZAI_BASE_URL = 'https://internal-api.z.ai/v1'
const ZAI_API_KEY = 'Z.ai'
const ZAI_CHAT_ID = 'chat-29bf48db-839a-48ab-a402-026a1fd7cc19'
const ZAI_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMmZkYWFkZmItZjAwMC00ODY3LWJiMDktZGM5Yjg1YTY5NzVlIiwiY2hhdF9pZCI6ImNoYXQtMjliZjQ4ZGItODM5YS00OGFiLWE0MDItMDI2YTFmZDdjYzE5IiwicGxhdGZvcm0iOiJ6YWkifQ.fMoxcqePFaXXPFrxh1ikzPOFYaFpyytyjc1QM8Nckf8'
const ZAI_USER_ID = '2fdaadfb-f000-4867-bb09-dc9b85a6975e'

function buildHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ZAI_API_KEY}`,
    'X-Z-AI-From': 'Z',
    'X-Chat-Id': ZAI_CHAT_ID,
    'X-User-Id': ZAI_USER_ID,
    'X-Token': ZAI_TOKEN,
  }
}

/**
 * Text AI — direct fetch to ZAI chat/completions
 * No SDK, no module loading, just raw fetch.
 */
export async function aiText(
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 7000
): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        messages,
        thinking: { type: 'disabled' },
      }),
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · aiText error ${res.status}: ${errText.slice(0, 200)}`)
      return null
    }

    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : null
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('Aether · aiText timed out')
    } else {
      logger.warn('Aether · aiText failed:', err instanceof Error ? err.message : err)
    }
    return null
  }
}

/**
 * Vision AI — direct fetch to ZAI chat/completions/vision
 * No SDK, no module loading, just raw fetch.
 */
export async function aiVision(
  prompt: string,
  imageDataUrl: string,
  timeoutMs = 8000
): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(`${ZAI_BASE_URL}/chat/completions/vision`, {
      method: 'POST',
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        }],
        thinking: { type: 'disabled' },
      }),
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.warn(`Aether · aiVision error ${res.status}: ${errText.slice(0, 200)}`)
      return ''
    }

    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : ''
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('Aether · aiVision timed out')
    } else {
      logger.warn('Aether · aiVision failed:', err instanceof Error ? err.message : err)
    }
    return ''
  }
}

/**
 * Strip markdown code fences from a string.
 */
export function stripCodeFences(raw: string): string {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json|text|html)?\s*/i, '').replace(/\s*```$/, '')
  }
  return cleaned
}
