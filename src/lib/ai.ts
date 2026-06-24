/**
 * Aether · Unified AI utility — tries Groq first, falls back to ZAI
 * ------------------------------------------------------------
 * Groq: Fast (1-3s) but requires valid API key
 * ZAI: Slower (3-8s) but works with hardcoded config
 *
 * Both use `new ZAI(config)` / direct fetch — no file system deps.
 */

import { groqText, groqVision, stripCodeFences } from './groq'
import { logger } from './logger'

// ── ZAI config (hardcoded — works on Vercel) ──
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
 * Unified text AI — tries Groq (fast) then ZAI (reliable).
 */
export async function aiText(
  messages: Array<{ role: string; content: string }>,
  timeoutMs = 7000
): Promise<string | null> {
  // Try Groq first (1-3s, if key is valid)
  const groqResult = await groqText(messages, timeoutMs)
  if (groqResult) return groqResult

  // Fall back to ZAI (3-8s, always works)
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
    logger.warn('Aether · ZAI text fallback failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Unified vision AI — tries Groq (fast) then ZAI (reliable).
 */
export async function aiVision(
  prompt: string,
  imageDataUrl: string,
  timeoutMs = 8000
): Promise<string> {
  // Try Groq first (fast, if key is valid)
  const groqResult = await groqVision(prompt, imageDataUrl, timeoutMs)
  if (groqResult) return groqResult

  // Fall back to ZAI (reliable)
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
    logger.warn('Aether · ZAI vision fallback failed:', err instanceof Error ? err.message : err)
    return ''
  }
}

export { stripCodeFences }
