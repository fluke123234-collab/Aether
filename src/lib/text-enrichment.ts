/**
 * Aether · Text enrichment utility — uses ZAI.create() for reliable LLM calls
 * ------------------------------------------------------------
 * ZAI.create() uses the SDK's built-in default configuration which
 * works on any host (including Vercel). No env vars needed.
 */

import { logger } from './logger'

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
 * Analyze text using ZAI.create() + chat.completions.create().
 * @param content - the raw text to analyze
 * @param timeoutMs - hard timeout (default 10s)
 * @returns JSON string of the AI response, or null on failure
 */
export async function analyzeTextWithCLI(
  content: string,
  timeoutMs = 12000
): Promise<string | null> {
  const text = (content ?? '').trim()
  if (!text || text.length < 20) return null

  try {
    const zai = await getZai()
    if (!zai) {
      logger.warn('Aether · text enrichment: ZAI.create() returned null')
      return null
    }

    const chatPromise = zai.chat.completions.create({
      messages: [
        { role: 'system', content: ENRICHMENT_PROMPT },
        { role: 'user', content: text.slice(0, 1000) },
      ],
    })

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    )

    const res = await Promise.race([chatPromise, timeoutPromise])
    if (!res) {
      logger.warn('Aether · text enrichment: timed out')
      return null
    }

    const raw = res.choices?.[0]?.message?.content
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim()
    }

    logger.warn('Aether · text enrichment: empty response')
    return null
  } catch (err) {
    logger.warn('Aether · text enrichment failed:', err instanceof Error ? err.message : err)
    return null
  }
}
