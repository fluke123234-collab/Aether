/**
 * Aether · Memory enrichment — uses Google Gemini
 */
import { geminiText, stripFences } from './gemini-ai'
import { logger } from './logger'

export type MemoryAnalysis = {
  title: string
  summary: string
  tags: string[]
  body?: string
}

const ENRICHMENT_PROMPT = `You are Aether's memory curator. Return JSON only.
Title max 5 words. Summary 1 sentence. 5 contextual tags.
Return: {"title":"...","summary":"...","tags":["t1","t2","t3","t4","t5"],"body":"corrected text"}`

function fallbackAnalysis(content: string): MemoryAnalysis {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (!clean) return { title: 'Untitled thought', summary: '', tags: ['capture'] }
  const words = clean.split(' ')
  const titleRaw = words.slice(0, 6).join(' ')
  const title = titleRaw.length > 60 ? titleRaw.slice(0, 57).trimEnd() + '…' : titleRaw
  return { title, summary: '', tags: ['capture'] }
}

export async function analyzeMemoryText(content: string): Promise<string> {
  const text = (content ?? '').trim()
  if (!text) return JSON.stringify(fallbackAnalysis(text))
  if (text.length < 20) return JSON.stringify(fallbackAnalysis(text))

  const raw = await geminiText(text.slice(0, 500), ENRICHMENT_PROMPT, 6000)
  if (raw) return raw

  logger.warn('Aether · enrichment fell back to heuristic')
  return JSON.stringify(fallbackAnalysis(text))
}
