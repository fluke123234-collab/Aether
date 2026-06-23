/** Aether · /api/recap — real AI synthesis of last 24h memories
 * ------------------------------------------------------------
 * Conditional states:
 *  - 0 memories in 24h → quiet: mindful prompt, no fake insights
 *  - 1-2 memories in 24h → sparse: a single gratitude/reflection prompt
 *  - 3+ memories in 24h → full AI synthesis with rich context payload
 *    (title + body + tags + image descriptions bundled for the LLM)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const ZAI_API_KEY = process.env.ZAI_API_KEY || ''
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1'

const RECAP_PROMPT = `You are Aether — an insightful companion reviewing the user's day. Give them a GENUINELY USEFUL daily reflection — not generic platitudes, but real analysis. BE SPECIFIC. Reference actual content. Find threads, surface tensions, note gaps. Output valid raw JSON: {"distillation":"3-5 sentence summary, second person, name actual topics.","insights":["specific insight 1","specific insight 2","specific insight 3"]}`

// Mindful prompts for sparse days — rotates so it doesn't feel repetitive
const SPARSE_PROMPTS = [
  'A quiet day in your sanctuary. What is one thing you want to remember from today?',
  'Not much was captured today. Take a breath — what is one small gratitude worth keeping?',
  'A still afternoon. What crossed your mind that you haven\'t yet written down?',
  'Your sanctuary is calm. What is one thought worth returning to tomorrow?',
]

const QUIET_PROMPT = 'Your sanctuary was quiet today. A still day is not an empty one — sometimes the mind rests so it can speak more clearly tomorrow.'

type RecapResponse = {
  success: boolean
  stats: { total: number; captured: number; recalled: number }
  distillation: string
  insights: string[]
  quiet?: boolean
  sparse?: boolean
  mindfulPrompt?: string
  error?: string
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null
  if (!token) return NextResponse.json({ success: false, error: 'unauthorized', stats: { total: 0, captured: 0, recalled: 0 }, distillation: '', insights: [] } satisfies RecapResponse, { status: 401 })
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, error: 'unauthorized', stats: { total: 0, captured: 0, recalled: 0 }, distillation: '', insights: [] } satisfies RecapResponse, { status: 401 })

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── Full 24h query: include tags + metadata (for image descriptions) + summary ──
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentMemories, error: memError } = await userClient
    .from('memories')
    .select('title, body, summary, tags, metadata, created_at')
    .eq('user_id', authData.user.id)
    .gte('created_at', twentyFourHoursAgo)
    .order('created_at', { ascending: true })

  if (memError) return NextResponse.json({ success: false, error: memError.message, stats: { total: 0, captured: 0, recalled: 0 }, distillation: '', insights: [] } satisfies RecapResponse, { status: 500 })

  const { count: totalCount } = await userClient.from('memories').select('*', { count: 'exact', head: true }).eq('user_id', authData.user.id)
  const capturedToday = recentMemories?.length ?? 0

  // ── Conditional state: QUIET (0 memories) ──
  if (!recentMemories || recentMemories.length === 0) {
    return NextResponse.json({
      success: true,
      stats: { total: totalCount ?? 0, captured: 0, recalled: 0 },
      distillation: QUIET_PROMPT,
      insights: [],
      quiet: true,
    } satisfies RecapResponse)
  }

  // ── Conditional state: SPARSE (1-2 memories — not enough for 3 distinct insights) ──
  if (recentMemories.length < 3) {
    // Rotate the mindful prompt based on day-of-year so it varies day to day
    const dayOfYear = Math.floor(Date.now() / (1000 * 60 * 60 * 24))
    const promptIndex = dayOfYear % SPARSE_PROMPTS.length
    return NextResponse.json({
      success: true,
      stats: { total: totalCount ?? 0, captured: capturedToday, recalled: 0 },
      distillation: SPARSE_PROMPTS[promptIndex],
      insights: [],
      sparse: true,
      mindfulPrompt: SPARSE_PROMPTS[promptIndex],
    } satisfies RecapResponse)
  }

  // ── Full AI synthesis (3+ memories) ──
  // Bundle each memory with its full context: title + body + summary + tags + image description
  const memoryText = recentMemories.map((m) => {
    const t = new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const tags = Array.isArray(m.tags) && m.tags.length > 0 ? ` [tags: ${m.tags.join(', ')}]` : ''
    const meta = m.metadata as { imageDescription?: string; searchKeywords?: string[] } | null
    const imgDesc = meta?.imageDescription ? ` [image: ${meta.imageDescription.slice(0, 200)}]` : ''
    const summary = m.summary ? ` (summary: ${m.summary.slice(0, 120)})` : ''
    return `[${t}] ${m.title || 'Untitled'}${tags}${summary}${imgDesc}\n  ${(m.body || '').slice(0, 400)}`
  }).join('\n\n')

  let distillation = 'Your day held a few quiet threads worth keeping.'
  let insights = ['The act of capturing is itself a form of attention.', 'Notice what recurs.', 'A thought kept is a thought honoured.']

  // Use ZAI.create() — works with built-in defaults on any host
  {
    try {
      const ZAIModule = await import('z-ai-web-dev-sdk')
      const ZAI = ZAIModule.default
      const zai = await ZAI.create()

      const chatPromise = zai.chat.completions.create({
        messages: [
          { role: 'system', content: RECAP_PROMPT },
          { role: 'user', content: memoryText },
        ],
      })

      // 12s timeout
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 12000)
      )

      const res = await Promise.race([chatPromise, timeoutPromise])
      if (res) {
        const raw = res.choices?.[0]?.message?.content ?? ''
        try {
          const p = JSON.parse(raw)
          if (typeof p.distillation === 'string') distillation = p.distillation.slice(0, 500)
          if (Array.isArray(p.insights)) {
            insights = p.insights
              .filter((s: unknown) => typeof s === 'string' && s.trim().length > 0)
              .slice(0, 3)
              .map((s: string) => s.trim())
          }
        } catch { /* keep defaults */ }
      }
    } catch (err) {
      logger.warn('Aether · recap failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({
    success: true,
    stats: { total: totalCount ?? 0, captured: capturedToday, recalled: 0 },
    distillation,
    insights,
  } satisfies RecapResponse)
}
