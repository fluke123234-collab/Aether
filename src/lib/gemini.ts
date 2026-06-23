/**
 * Aether · Memory enrichment — uses z-ai CLI for reliable AI tagging
 * ------------------------------------------------------------
 * Tries the z-ai CLI first (proven to work, ~0.5-2s). If it fails,
 * uses an instant heuristic fallback that generates a title, summary,
 * and tags without any API call.
 *
 * Tags are generated invisibly — they power semantic search in
 * /api/ask but are never rendered in the UI.
 */

import { logger } from './logger'
import { analyzeTextWithCLI } from './text-enrichment'

export type MemoryAnalysis = {
  title: string
  summary: string
  tags: string[]
  body?: string
}

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
    pc: 'technology', cpu: 'technology', gpu: 'technology', hardware: 'technology',
    build: 'technology', specs: 'technology', intel: 'technology', amd: 'technology',
    motherboard: 'technology', ram: 'technology', ssd: 'technology', monitor: 'technology',
  }
  for (const [kw, tag] of Object.entries(hints)) {
    if (lower.includes(kw) && tags.size < 5) tags.add(tag)
  }

  return { title, summary, tags: Array.from(tags) }
}

export async function analyzeMemoryText(content: string): Promise<string> {
  const text = (content ?? '').trim()
  if (!text) return JSON.stringify(fallbackAnalysis(text))

  // Short text (under 20 chars) — use heuristic, don't waste an API call.
  if (text.length < 20) return JSON.stringify(fallbackAnalysis(text))

  // Try the z-ai CLI first (proven to work reliably).
  const cliResult = await analyzeTextWithCLI(text, 10000)
  if (cliResult) {
    const parsed = parseAnalysisJson(cliResult, text)
    if (parsed) return JSON.stringify(parsed)
  }

  // Instant fallback — no API call, no delay.
  logger.warn('Aether · enrichment fell back to heuristic')
  return JSON.stringify(fallbackAnalysis(text))
}

function parseAnalysisJson(raw: string, text: string): MemoryAnalysis | null {
  try {
    let parsed: { title?: unknown; summary?: unknown; tags?: unknown; body?: unknown }
    try { parsed = JSON.parse(raw) } catch { const match = raw.match(/\{[\s\S]*\}/); parsed = match ? JSON.parse(match[0]) : {} }
    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim().slice(0, 80) : fallbackAnalysis(text).title
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 200) : ''
    // Allow up to 5 tags (was 3 — limited search indexing)
    const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, 5) : ['capture']
    const body = typeof parsed.body === 'string' && parsed.body.trim() ? parsed.body.trim().slice(0, 500) : undefined
    return { title, summary, tags: tags.length ? tags : ['capture'], body }
  } catch { return null }
}
