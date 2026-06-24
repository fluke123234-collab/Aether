/**
 * Aether · VLM utility — uses ZAI.create() for reliable image analysis
 * ------------------------------------------------------------
 * ZAI.create() uses the SDK's built-in default configuration which
 * works on any host (including Vercel). No env vars needed.
 *
 * Images are compressed to max 1024px with sharpen filter before
 * upload — preserves text-contrast edges for high-fidelity OCR while
 * reducing upload time and API latency.
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
 * Compress an image data URL to max 768px with sharpen filter for OCR.
 * Falls back to the original if sharp fails or takes too long.
 * Uses 768px (not 1024) for faster processing on Vercel's 10s limit.
 */
async function compressImageForVision(imageDataUrl: string): Promise<string> {
  try {
    if (!imageDataUrl.startsWith('data:image/')) return imageDataUrl
    if (imageDataUrl.length < 50000) return imageDataUrl // already small

    const mimeMatch = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
    if (!mimeMatch) return imageDataUrl
    const buffer = Buffer.from(mimeMatch[2], 'base64')

    // Use a 2s timeout for compression — if it takes longer, skip it
    const sharp = (await import('sharp')).default
    const compressPromise = sharp(buffer)
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .sharpen({ sigma: 1.0, flat: 1.0, jagged: 0.5 })
      .jpeg({ quality: 80 })
      .toBuffer()

    const timeoutPromise = new Promise<Buffer>((resolve) => {
      setTimeout(() => resolve(buffer), 2000) // fallback to original buffer
    })

    const compressed = await Promise.race([compressPromise, timeoutPromise])
    return `data:image/jpeg;base64,${compressed.toString('base64')}`
  } catch (err) {
    logger.warn('Aether · image compression failed, using original:', err instanceof Error ? err.message : err)
    return imageDataUrl
  }
}

/**
 * Analyze an image using ZAI.create() + createVision().
 * Automatically compresses the image to 1024px with sharpen filter
 * before upload for faster transmission and better OCR fidelity.
 *
 * @param imageDataUrl - base64 data URL (data:image/...;base64,...)
 * @param prompt - the analysis prompt
 * @param timeoutMs - hard timeout (default 15s)
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

    // Compress the image before sending to the VLM (1024px, sharpen, JPEG@85)
    const compressedImage = await compressImageForVision(imageDataUrl)

    // Build the vision request
    const visionPromise = zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: compressedImage } },
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
