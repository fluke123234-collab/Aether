/**
 * Aether · Unified AI utility — ZAI only (hardcoded config)
 * ------------------------------------------------------------
 * Uses `new ZAI(config)` with hardcoded credentials.
 * No Groq, no env vars, no config files.
 * Works on any host including Vercel.
 */

import { logger } from './logger'

const ZAI_CONFIG = {
  baseUrl: 'https://internal-api.z.ai/v1',
  apiKey: 'Z.ai',
  chatId: 'chat-29bf48db-839a-48ab-a402-026a1fd7cc19',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMmZkYWFkZmItZjAwMC00ODY3LWJiMDktZGM5Yjg1YTY5NzVlIiwiY2hhdF9pZCI6ImNoYXQtMjliZjQ4ZGItODM5YS00OGFiLWE0MDItMDI2YTFmZDdjYzE5IiwicGxhdGZvcm0iOiJ6YWkifQ.fMoxcqePFaXXPFrxh1ikzPOFYaFpyytyjc1QM8Nckf8',
  userId: '2fdaadfb-f000-4867-bb09-dc9b85a6975e',
}

let zaiInstance: Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default>> | null = null

async function getZai() {
  if (zaiInstance) return zaiInstance
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    zaiInstance = new ZAIModule.default(ZAI_CONFIG)
    return zaiInstance
  } catch (err) {
    logger.error('Aether · ZAI init failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Text AI — ZAI chat.completions.create()
 */
export async function aiText(
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 7000
): Promise<string | null> {
  try {
    const zai = await getZai()
    if (!zai) return null

    const chatPromise = zai.chat.completions.create({ messages })
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    const res = await Promise.race([chatPromise, timeoutPromise])
    if (!res) return null

    const content = res.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : null
  } catch (err) {
    logger.warn('Aether · aiText failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Vision AI — ZAI chat.completions.createVision()
 */
export async function aiVision(
  prompt: string,
  imageDataUrl: string,
  timeoutMs = 8000
): Promise<string> {
  try {
    const zai = await getZai()
    if (!zai) return ''

    const visionPromise = zai.chat.completions.createVision({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      }],
      thinking: { type: 'disabled' },
    })

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    const res = await Promise.race([visionPromise, timeoutPromise])
    if (!res) return ''

    const content = res.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : ''
  } catch (err) {
    logger.warn('Aether · aiVision failed:', err instanceof Error ? err.message : err)
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
