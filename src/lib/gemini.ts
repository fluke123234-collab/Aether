/**
 * Aether · Phase 3 — Consolidated Gemini utility
 * ------------------------------------------------------------
 * A SINGLE background worker that derives { title, summary, tags }
 * from raw memory text in one token-efficient Gemini request.
 *
 * - Uses process.env.GEMINI_API_KEY (server-side only).
 * - Forces native JSON output mode so parsing never hangs.
 * - On any failure (missing key, rate limit, bad syntax) it falls
 *   back to a deterministic heuristic so the row still resolves
 *   instead of hanging in "processing" forever.
 */

import { logger } from './logger'

export type MemoryAnalysis = {
  title: string
  summary: string
  tags: string[]
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const SYSTEM_PROMPT = `You are Aether's memory curator. Given a raw captured thought, return metadata as valid raw JSON only.

Be extremely brief. Do not wrap the JSON in markdown code blocks. Output valid raw JSON only. Keep the summary under 25 words. The title must be at most 5 words, in Title Case, no trailing punctuation.

Return exactly this shape and nothing else:
{"title":"Hyper-concise title (max 5 words)","summary":"1-2 sentence maximum retrospective summary.","tags":["Tag1","Tag2","Tag3"]}

Rules for tags:
- 1 to 3 tags, single words or short compounds, PascalCase.
- Lowercase first tag style is also fine; just be consistent.
- No emojis, no quotes inside tags.`

/* ── Heuristic fallback — keeps the row resolving without an API key ── */

function fallbackAnalysis(content: string): MemoryAnalysis {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (!clean) {
    return { title: 'Untitled thought', summary: '', tags: ['capture'] }
  }

  // Title = first <=6 words, truncated gracefully.
  const words = clean.split(' ')
  const titleRaw = words.slice(0, 6).join(' ')
  const title =
    titleRaw.length > 60
      ? titleRaw.slice(0, 57).trimEnd() + '…'
      : words.length > 6
        ? titleRaw + '…'
        : titleRaw

  // Summary = first sentence (up to ~160 chars), clamped to 25 words.
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean
  const summaryWords = firstSentence.split(' ').slice(0, 25).join(' ')
  const summary =
    summaryWords.length > 160 ? summaryWords.slice(0, 157).trimEnd() + '…' : summaryWords

  // Tags = a couple of naive keyword hints; always includes "capture".
  const lower = clean.toLowerCase()
  const tags = new Set<string>(['capture'])
  const hints: Record<string, string> = {
    idea: 'idea', product: 'product', design: 'design', book: 'reading',
    read: 'reading', reading: 'reading', quote: 'quote', strategy: 'strategy',
    goal: 'strategy', ritual: 'ritual', habit: 'ritual', meeting: 'work',
    code: 'engineering', bug: 'engineering', ship: 'work', money: 'finance',
  }
  for (const [kw, tag] of Object.entries(hints)) {
    if (lower.includes(kw) && tags.size < 3) tags.add(tag)
  }

  return { title, summary, tags: Array.from(tags) }
}

/* ── The single consolidated Gemini call ──
 * Returns a JSON STRING (not a parsed object) so the caller can
 * log the raw payload and parse it inside a try/catch — this gives
 * full traceability when a Gemini response is malformed or rate-limited.
 * The internal fallback guarantees the returned string is always valid JSON.
 */

export async function analyzeMemoryText(content: string): Promise<string> {
  const text = (content ?? '').trim()
  if (!text) return JSON.stringify(fallbackAnalysis(text))

  if (!GEMINI_API_KEY) {
    // No key configured — resolve deterministically so the pipeline still flows.
    logger.warn('Aether · GEMINI_API_KEY not set — using heuristic metadata.')
    return JSON.stringify(fallbackAnalysis(text))
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 200,
          // Native JSON mode — eliminates most parsing failures.
          responseMimeType: 'application/json',
        },
      }),
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`Gemini HTTP ${res.status}: ${errBody.slice(0, 120)}`)
    }

    const json = await res.json()
    const raw: string =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ??
      json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ??
      ''

    // Strict parse — wrapped so a bad payload never crashes the worker.
    let parsed: { title?: unknown; summary?: unknown; tags?: unknown }
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Last-resort: scrape a JSON object out of the text.
      const match = raw.match(/\{[\s\S]*\}/)
      parsed = match ? JSON.parse(match[0]) : {}
    }

    const title =
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim().slice(0, 80)
        : fallbackAnalysis(text).title
    const summary =
      typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 280) : ''
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t) => t.trim())
          .slice(0, 3)
      : ['capture']

    const result: MemoryAnalysis = {
      title,
      summary,
      tags: tags.length ? tags : ['capture'],
    }
    return JSON.stringify(result)
  } catch (err) {
    // Rate limit, network, syntax — never hang the row.
    logger.warn(
      'Aether · analyzeMemoryText fell back:',
      err instanceof Error ? err.message : err
    )
    return JSON.stringify(fallbackAnalysis(text))
  }
}
