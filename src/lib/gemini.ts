/**
 * Aether · Memory enrichment — fast, token-efficient
 * ------------------------------------------------------------
 * Tries Z.ai first (5s timeout). If it fails, uses an instant
 * heuristic fallback that generates a title, summary, and tags
 * without any API call. This keeps captures fast even when the
 * AI is unavailable, and saves tokens by only calling the AI
 * for text that actually needs it.
 */

import { logger } from './logger'

export type MemoryAnalysis = {
  title: string
  summary: string
  tags: string[]
  body?: string
}

const ZAI_API_KEY = process.env.ZAI_API_KEY || ''
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1'

const ENRICHMENT_PROMPT = `You are Aether's memory curator. Given a raw captured thought, return metadata as valid raw JSON only. No markdown code blocks.

Be extremely brief. Title max 5 words, Title Case, no trailing punctuation. Summary 1 sentence max 15 words, proper punctuation. Generate 5 highly contextual tags (lowercase, single words or short hyphenated phrases) that capture the key topics, themes, and entities — these power semantic search so be specific and comprehensive.

ALSO: fix the body text — correct spelling, add proper capitalization and punctuation (periods, commas, apostrophes). Keep the user's original words but make it grammatically correct.

Return exactly: {"title":"...","summary":"...","tags":["tag1","tag2","tag3","tag4","tag5"],"body":"corrected body text with proper punctuation"}`

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

  // Try Z.ai with a short 5s timeout.
  if (ZAI_API_KEY) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ZAI_API_KEY}`,
        'X-Z-AI-From': 'Z',
      }
      if (process.env.ZAI_CHAT_ID) headers['X-Chat-Id'] = process.env.ZAI_CHAT_ID
      if (process.env.ZAI_USER_ID) headers['X-User-Id'] = process.env.ZAI_USER_ID
      if (process.env.ZAI_TOKEN) headers['X-Token'] = process.env.ZAI_TOKEN

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4000)

      const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            { role: 'system', content: ENRICHMENT_PROMPT },
            { role: 'user', content: text.slice(0, 500) }, // Truncate to save tokens
          ],
          thinking: { type: 'disabled' },
        }),
      })

      clearTimeout(timeout)

      if (res.ok) {
        const json = await res.json()
        const raw = json?.choices?.[0]?.message?.content ?? ''
        const parsed = parseAnalysisJson(raw, text)
        if (parsed) return JSON.stringify(parsed)
      }
    } catch (err) {
      logger.warn('Aether · enrichment fell back:', err instanceof Error ? err.message : err)
    }
  }

  // Instant fallback — no API call, no delay.
  return JSON.stringify(fallbackAnalysis(text))
}

function parseAnalysisJson(raw: string, text: string): MemoryAnalysis | null {
  try {
    let parsed: { title?: unknown; summary?: unknown; tags?: unknown; body?: unknown }
    try { parsed = JSON.parse(raw) } catch { const match = raw.match(/\{[\s\S]*\}/); parsed = match ? JSON.parse(match[0]) : {} }
    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 80) : fallbackAnalysis(text).title
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 200) : ''
    const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, 3) : ['capture']
    const body = typeof parsed.body === 'string' && parsed.body.trim() ? parsed.body.trim().slice(0, 500) : undefined
    return { title, summary, tags: tags.length ? tags : ['capture'], body }
  } catch { return null }
}
