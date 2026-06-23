/**
 * Aether · VLM utility — uses the z-ai CLI for reliable image analysis
 * ------------------------------------------------------------
 * The z-ai-web-dev-sdk's createVision() can fail silently on serverless
 * platforms (Vercel) due to timeout/config issues. The z-ai CLI is
 * proven to work reliably and returns in ~4-5 seconds.
 *
 * This utility writes the image to a temp file, calls the CLI, and
 * parses the JSON response. Falls back to empty string on any error.
 */

import { writeFile, unlink, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

/**
 * Analyze an image using the z-ai CLI vision command.
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
  const tmpDir = '/tmp/aether-vlm'
  const tmpFile = join(tmpDir, `img-${randomUUID()}.jpg`)

  try {
    // Ensure tmp dir exists
    if (!existsSync(tmpDir)) {
      await mkdir(tmpDir, { recursive: true })
    }

    // Extract base64 data from the data URL
    const mimeMatch = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
    if (!mimeMatch) {
      logger.warn('Aether · VLM CLI: invalid data URL format')
      return ''
    }

    const base64Data = mimeMatch[2]
    const buffer = Buffer.from(base64Data, 'base64')
    await writeFile(tmpFile, buffer)

    // Call the z-ai CLI vision command
    const { stdout } = await execFileAsync(
      'z-ai',
      ['vision', '-p', prompt, '-i', tmpFile],
      {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large responses
      }
    )

    // Parse the JSON response from stdout
    try {
      const json = JSON.parse(stdout)
      const content = json?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.trim()) {
        return content.trim()
      }
    } catch {
      // If JSON parse fails, return the raw stdout (might be plain text)
      if (stdout.trim()) return stdout.trim().slice(0, 4000)
    }

    return ''
  } catch (err) {
    logger.warn(
      'Aether · VLM CLI failed:',
      err instanceof Error ? err.message : err
    )
    return ''
  } finally {
    // Clean up temp file
    try {
      if (existsSync(tmpFile)) await unlink(tmpFile)
    } catch {}
  }
}
