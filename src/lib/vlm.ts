/**
 * Aether · ZAI Configuration
 * ------------------------------------------------------------
 * Hardcoded ZAI config — bypasses loadConfig() which reads from
 * a .z-ai-config file that doesn't exist on Vercel.
 * 
 * Using `new ZAI(config)` directly instead of `ZAI.create()`.
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

/**
 * Get a shared ZAI instance.
 * Uses `new ZAI(config)` with hardcoded credentials — works on ANY host
 * including Vercel. Does NOT rely on .z-ai-config file or ZAI.create().
 */
export async function getZai() {
  if (zaiInstance) return zaiInstance
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    zaiInstance = new ZAI(ZAI_CONFIG)
    logger.info('Aether · ZAI instance created with hardcoded config')
    return zaiInstance
  } catch (err) {
    logger.error('Aether · Failed to create ZAI instance:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Analyze an image using ZAI vision.
 * @param imageDataUrl - base64 data URL (data:image/...;base64,...)
 * @param prompt - the analysis prompt
 * @param timeoutMs - hard timeout (default 8s)
 * @returns The vision model's text response, or empty string on failure
 */
export async function analyzeImageWithCLI(
  imageDataUrl: string,
  prompt: string,
  timeoutMs = 8000
): Promise<string> {
  try {
    const zai = await getZai()
    if (!zai) {
      logger.warn('Aether · VLM: getZai() returned null')
      return ''
    }

    const visionPromise = zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    )

    const res = await Promise.race([visionPromise, timeoutPromise])
    if (!res) {
      logger.warn('Aether · VLM: timed out after', timeoutMs, 'ms')
      return ''
    }

    const content = res.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.trim()) {
      return content.trim()
    }

    logger.warn('Aether · VLM: empty response')
    return ''
  } catch (err) {
    logger.warn('Aether · VLM failed:', err instanceof Error ? err.message : err)
    return ''
  }
}
