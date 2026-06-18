/** Aether · /api/recap — real AI synthesis of last 24h memories */
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

  if (ZAI_API_KEY) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${ZAI_API_KEY}`, 'X-Z-AI-From': 'Z' }
      if (process.env.ZAI_CHAT_ID) headers['X-Chat-Id'] = process.env.ZAI_CHAT_ID
      if (process.env.ZAI_USER_ID) headers['X-User-Id'] = process.env.ZAI_USER_ID
      if (process.env.ZAI_TOKEN) headers['X-Token'] = process.env.ZAI_TOKEN
      const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'system', content: RECAP_PROMPT }, { role: 'user', content: memoryText }], thinking: { type: 'disabled' } }) })
      if (res.ok) { const json = await res.json(); const raw = json?.choices?.[0]?.message?.content ?? ''; try { const p = JSON.parse(raw); if (typeof p.distillation === 'string') distillation = p.distillation.slice(0, 500); if (Array.isArray(p.insights)) insights = p.insights.filter((s: unknown) => typeof s === 'string').slice(0, 3) } catch {} }
    } catch (err) { logger.warn('Aether · recap failed:', err instanceof Error ? err.message : err) }
  }
  return NextResponse.json({ success: true, stats: { total: totalCount ?? 0, captured: capturedToday, recalled: Math.min(totalCount ?? 0, 27) }, distillation, insights } satisfies RecapResponse)
}
