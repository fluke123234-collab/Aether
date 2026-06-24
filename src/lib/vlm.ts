/**
 * Aether · VLM utility — ZAI.create() + createVision() with NO compression
 * ------------------------------------------------------------
 * The frontend already compresses images to 1024px JPEG@0.8.
 * sharp (native module) is slow/unreliable on Vercel serverless.
 * So we skip server-side compression entirely and pass the image
 * directly to createVision().
 */

import { logger } from './logger'

let zaiInstance: Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>> | null = null
let zaiPromise: Promise<typeof zaiInstance> | null = null

async function getZai() {
  if (zaiInstance) return zaiInstance
  if (zaiPromise) return zaiPromise
  zaiPromise = (async () => {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    zaiInstance = await ZAI.create()
    return zaiInstance
  })()
  return zaiPromise
}

/**
 * Analyze an image using ZAI.create() + createVision().
 * NO server-side compression — the frontend already compresses.
 *
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
      logger.warn('Aether · VLM: ZAI.create() returned null')
      return ''
    }

    // Pass the image directly — NO compression (frontend already did it)
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

    // Hard timeout via Promise.race
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
