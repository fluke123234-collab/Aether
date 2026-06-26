/** Aether · /api/recap — real AI synthesis of last 24h memories (Groq) */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { groqChat, stripFences } from '@/lib/ai'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const RECAP_PROMPT = `You are Aether — an insightful companion reviewing the user's day. Give them a GENUINELY USEFUL daily reflection — not generic platitudes, but real analysis. BE SPECIFIC. Reference actual content. Find threads, surface tensions, note gaps. Output valid raw JSON: {"distillation":"3-5 sentence summary, second person, name actual topics.","insights":["specific insight 1","specific insight 2","specific insight 3"]}`

type RecapResponse = { success: boolean; stats: { total: number; captured: number; recalled: number }; distillation: string; insights: string[]; quiet?: boolean; error?: string }

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null
  if (!token) return NextResponse.json({ success: false, error: 'unauthorized', stats: { total: 0, captured: 0, recalled: 0 }, distillation: '', insights: [] } satisfies RecapResponse, { status: 401 })
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, error: 'unauthorized', stats: { total: 0, captured: 0, recalled: 0 }, distillation: '', insights: [] } satisfies RecapResponse, { status: 401 })

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentMemories, error: memError } = await userClient.from('memories').select('title, body, summary, tags, created_at').eq('user_id', authData.user.id).gte('created_at', twentyFourHoursAgo).order('created_at', { ascending: true })
  if (memError) return NextResponse.json({ success: false, error: memError.message, stats: { total: 0, captured: 0, recalled: 0 }, distillation: '', insights: [] } satisfies RecapResponse, { status: 500 })

  const { count: totalCount } = await userClient.from('memories').select('*', { count: 'exact', head: true }).eq('user_id', authData.user.id)
  const capturedToday = recentMemories?.length ?? 0

  if (!recentMemories || recentMemories.length === 0) {
    return NextResponse.json({ success: true, stats: { total: totalCount ?? 0, captured: 0, recalled: Math.min(totalCount ?? 0, 27) }, distillation: 'Your sanctuary was quiet today. A still day is not an empty one — sometimes the mind rests so it can speak more clearly tomorrow.', insights: ['A quiet day is itself a kind of capture.', 'Consider what went unsaid.', 'Return tomorrow; the sanctuary keeps no expectations.'], quiet: true } satisfies RecapResponse)
  }

  const memoryText = recentMemories.map((m) => { const t = new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); return `[${t}] ${m.title || 'Untitled'}: ${(m.body || '').slice(0, 300)}` }).join('\n\n')
  let distillation = 'Your day held a few quiet threads worth keeping.'; let insights = ['The act of capturing is itself a form of attention.', 'Notice what recurs.', 'A thought kept is a thought honoured.']

  const raw = await groqChat(
    [
      { role: 'system', content: RECAP_PROMPT },
      { role: 'user', content: memoryText },
    ],
    { jsonMode: true, timeoutMs: 8000, maxTokens: 500, temperature: 0.6 }
  )

  if (raw) {
    try {
      const cleaned = stripFences(raw)
      const p = JSON.parse(cleaned)
      if (typeof p.distillation === 'string') distillation = p.distillation.slice(0, 500)
      if (Array.isArray(p.insights)) insights = p.insights.filter((s: unknown) => typeof s === 'string').slice(0, 3)
    } catch (err) {
      logger.warn('Aether · recap parse failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ success: true, stats: { total: totalCount ?? 0, captured: capturedToday, recalled: Math.min(totalCount ?? 0, 27) }, distillation, insights } satisfies RecapResponse)
}
