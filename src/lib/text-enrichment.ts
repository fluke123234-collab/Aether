/**
 * Aether · Text enrichment utility — uses the z-ai CLI for reliable LLM calls
 * ------------------------------------------------------------
 * The z-ai-web-dev-sdk direct API calls fail silently when ZAI_API_KEY
 * is not set in the environment. The z-ai CLI has its own built-in
 * configuration that works reliably. This utility calls the CLI for
 * text analysis (tag generation, title/summary/body correction).
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

const ENRICHMENT_PROMPT = `You are Aether's memory curator. Given a raw captured thought, return metadata as valid raw JSON only. No markdown code blocks.

Be extremely brief. Title max 5 words, Title Case, no trailing punctuation. Summary 1 sentence max 15 words, proper punctuation. Generate 5 highly contextual tags (lowercase, single words or short hyphenated phrases) that capture the key topics, themes, and entities — these power semantic search so be specific and comprehensive.

ALSO: fix the body text — correct spelling, add proper capitalization and punctuation (periods, commas, apostrophes). Keep the user's original words but make it grammatically correct.

Return exactly: {"title":"...","summary":"...","tags":["tag1","tag2","tag3","tag4","tag5"],"body":"corrected body text with proper punctuation"}`

export type MemoryAnalysis = {
  title: string
  summary: string
  tags: string[]
  body?: string
}

/**
 * Analyze text using the z-ai CLI chat command.
 * @param content - the raw text to analyze
 * @param timeoutMs - hard timeout (default 10s)
 * @returns JSON string of MemoryAnalysis, or null on failure
 */
export async function analyzeTextWithCLI(
  content: string,
  timeoutMs = 10000
): Promise<string | null> {
  const text = (content ?? '').trim()
  if (!text || text.length < 20) return null

  try {
    const { stdout } = await execFileAsync(
      'z-ai',
      ['chat', '-p', text.slice(0, 1000), '-s', ENRICHMENT_PROMPT],
      {
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024,
      }
    )

    // Parse the JSON response from stdout
    try {
      const json = JSON.parse(stdout)
      const raw = json?.choices?.[0]?.message?.content
      if (typeof raw === 'string' && raw.trim()) {
        return raw.trim()
      }
    } catch {
      // If JSON parse fails, return raw stdout
      if (stdout.trim()) return stdout.trim()
    }

    return null
  } catch (err) {
    logger.warn('Aether · text enrichment CLI failed:', err instanceof Error ? err.message : err)
    return null
  }
}
