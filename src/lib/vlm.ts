/**
 * Aether · VLM utility — uses ZAI.create() for reliable image analysis
 * ------------------------------------------------------------
 * ZAI.create() uses the SDK's built-in default configuration which
 * works on any host (including Vercel). No env vars needed.
 *
 * The `new ZAI(config)` approach requires explicit credentials that
 * aren't available on Vercel. The `z-ai` CLI approach only works locally.
 * ZAI.create() is the only approach that works everywhere.
 */

import { logger } from './logger'

let zaiInstance: Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>> | null = null
let zaiPromise: Promise<typeof zaiInstance> | null = null

/**
 * Get a shared ZAI instance (created once, reused across calls).
 */
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
 * @param imageDataUrl - base64 data URL (data:image/...;base64,...)
 * @param prompt - the analysis prompt
 * @param timeoutMs - hard timeout (default 15s)
 * @returns The vision model's text response, or empty string on failure
 */
export async function analyzeImageWithCLI(
  imageDataUrl: string,
  prompt: string,
  timeoutMs = 15000
): Promise<string> {
  try {
    const zai = await getZai()
    if (!zai) {
      logger.warn('Aether · VLM: ZAI.create() returned null')
      return ''
    }

    // Build the vision request
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
