/**
 * Aether · Memory enrichment — powered by Groq
 * ------------------------------------------------------------
 * Uses Groq (llama-3.3-70b-versatile) for fast, token-efficient
 * title/summary/tags/body enrichment. Falls back to an instant
 * heuristic if the API is unavailable so captures never block.
 */

import { groqChat, stripFences } from './ai'
import { logger } from './logger'

export type MemoryAnalysis = {
  title: string
  summary: string
  tags: string[]
  body?: string
}

const ENRICHMENT_PROMPT = `You are Aether's memory curator. Given a raw captured thought, return metadata as valid raw JSON only. No markdown code blocks.

Be extremely brief. Title max 5 words, Title Case, no trailing punctuation. Summary 1 sentence max 15 words, proper punctuation. 1-3 tags, lowercase.

ALSO: fix the body text — correct spelling, add proper capitalization and punctuation (periods, commas, apostrophes). Keep the user's original words but make it grammatically correct.

Return exactly: {"title":"...","summary":"...","tags":["tag1","tag2"],"body":"corrected body text with proper punctuation"}`

/* ── Instant heuristic fallback — no API call needed ── */
function fallbackAnalysis(content: string): MemoryAnalysis {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (!clean) return { title: 'Untitled thought', summary: '', tags: ['capture'] }

  const words = clean.split(' ')
  const titleRaw = words.slice(0, 6).join(' ')
  const title = titleRaw.length > 60 ? titleRaw.slice(0, 57).trimEnd() + '…' : (words.length > 6 ? titleRaw + '…' : titleRaw)

  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean
  const summaryWords = firstSentence.split(' ').slice(0, 15).join(' ')
  const summary = summaryWords.length > 120 ? summaryWords.slice(0, 117).trimEnd() + '…' : summaryWords

  const lower = clean.toLowerCase()
  const tags = new Set<string>(['capture'])
  const hints: Record<string, string> = {
    idea: 'idea', product: 'product', design: 'design', book: 'reading', read: 'reading',
    reading: 'reading', quote: 'quote', strategy: 'strategy', goal: 'strategy',
    ritual: 'ritual', meeting: 'work', code: 'engineering', bug: 'engineering',
    ship: 'work', money: 'finance', budget: 'finance', dollar: 'finance',
    health: 'health', gym: 'health', sleep: 'health', food: 'health',
    family: 'personal', friend: 'personal', love: 'personal',
    task: 'task', todo: 'task', need: 'task', must: 'task', should: 'task',
    buy: 'task', call: 'task', send: 'task', fix: 'task', finish: 'task',
  }
  for (const [kw, tag] of Object.entries(hints)) {
    if (lower.includes(kw) && tags.size < 3) tags.add(tag)
  }

  return { title, summary, tags: Array.from(tags) }
}

export async function analyzeMemoryText(content: string): Promise<string> {
  const text = (content ?? '').trim()
  if (!text) return JSON.stringify(fallbackAnalysis(text))

  // Short text (under 20 chars) — use heuristic, don't waste an API call.
  if (text.length < 20) return JSON.stringify(fallbackAnalysis(text))

  // Try Groq with a 5s timeout.
  const raw = await groqChat(
    [
      { role: 'system', content: ENRICHMENT_PROMPT },
      { role: 'user', content: text.slice(0, 500) },
    ],
    { jsonMode: true, timeoutMs: 5000, maxTokens: 300, temperature: 0.3 }
  )

  if (raw) {
    const parsed = parseAnalysisJson(raw, text)
    if (parsed) return JSON.stringify(parsed)
  }

  // Instant fallback — no API call, no delay.
  logger.warn('Aether · enrichment using heuristic fallback')
  return JSON.stringify(fallbackAnalysis(text))
}

function parseAnalysisJson(raw: string, text: string): MemoryAnalysis | null {
  try {
    const cleaned = stripFences(raw)
    let parsed: { title?: unknown; summary?: unknown; tags?: unknown; body?: unknown }
    try { parsed = JSON.parse(cleaned) } catch { const match = cleaned.match(/\{[\s\S]*\}/); parsed = match ? JSON.parse(match[0]) : {} }
    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 80) : fallbackAnalysis(text).title
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 200) : ''
    const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, 3) : ['capture']
    const body = typeof parsed.body === 'string' && parsed.body.trim() ? parsed.body.trim().slice(0, 500) : undefined
    return { title, summary, tags: tags.length ? tags : ['capture'], body }
  } catch { return null }
}
