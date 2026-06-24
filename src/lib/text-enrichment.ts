/**
 * Aether · Text enrichment — uses Groq (llama-3.3-70b-versatile)
 */
import { aiText, stripCodeFences } from './ai'
import { logger } from './logger'

const ENRICHMENT_PROMPT = `You are Aether's memory curator. Given a raw captured thought, return metadata as valid raw JSON only. No markdown code blocks.

Be extremely brief. Title max 5 words, Title Case. Summary 1 sentence max 15 words. Generate 5 highly contextual tags (lowercase).

Return exactly: {"title":"...","summary":"...","tags":["tag1","tag2","tag3","tag4","tag5"],"body":"corrected body text"}`

export type MemoryAnalysis = {
  title: string
  summary: string
  tags: string[]
  body?: string
}

export async function analyzeTextWithCLI(
  content: string,
  timeoutMs = 6000
): Promise<string | null> {
  const text = (content ?? '').trim()
  if (!text || text.length < 20) return null

  const raw = await aiText([
    { role: 'system', content: ENRICHMENT_PROMPT },
    { role: 'user', content: text.slice(0, 1000) },
  ], timeoutMs)

  if (!raw) {
    logger.warn('Aether · text enrichment: Groq returned null')
    return null
  }

  return stripCodeFences(raw)
}
