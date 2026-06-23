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
 * Extract the JSON object from CLI output that may contain
 * non-JSON prefix lines (like '🚀 Initializing Z-AI SDK...').
 */
function extractJson(stdout: string): string | null {
  if (!stdout || !stdout.trim()) return null
  // Find the first '{' and extract from there to the matching '}'
  const start = stdout.indexOf('{')
  if (start === -1) return null
  // Find the last '}' to get the complete JSON object
  const end = stdout.lastIndexOf('}')
  if (end === -1 || end <= start) return null
  return stdout.slice(start, end + 1)
}

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

    // The CLI outputs non-JSON prefix lines (🚀 Initializing...) to stdout
    // before the actual JSON. Extract just the JSON object.
    const jsonStr = extractJson(stdout)
    if (!jsonStr) {
      logger.warn('Aether · VLM CLI: no JSON found in stdout')
      return ''
    }

    try {
      const json = JSON.parse(jsonStr)
      const content = json?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.trim()) {
        return content.trim()
      }
    } catch (parseErr) {
      logger.warn('Aether · VLM CLI JSON parse failed:', parseErr instanceof Error ? parseErr.message : parseErr)
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
