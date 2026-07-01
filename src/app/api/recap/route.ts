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

const RECAP_PROMPT = `You are the Aether Autonomous Mind Engine. Do not summarize like a text editor. Analyze the user's unstructured daily dump (text, audio transcriptions, image tags) and output a strict JSON payload with these exact structures:

{"radar":{"title":"The single highest-density topic they focused on today","truth":"One sentence harsh truth about their productivity pattern today"},"debt":["2-3 implicit unwritten tasks they forgot to explicitly write down, phrased as actionable checklist items"],"catalyst":"One deeply personalized, counter-intuitive prompt designed to unblock their brain tomorrow morning"}

Rules:
- No corporate jargon or platitudes. Be specific to their actual content.
- The radar truth must be brutally honest but constructive.
- The debt items must be real implicit tasks inferred from their notes, not generic.
- The catalyst must be counter-intuitive — not obvious advice.
- Output valid raw JSON only, no markdown.`

type RecapResponse = { success: boolean; stats: { total: number; captured: number; recalled: number }; distillation: string; insights: string[]; quiet?: boolean; sparse?: boolean; error?: string }

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
  let distillation = `You captured ${capturedToday} thoughts today. Here is your mind, mirrored back.`
  let insights: string[] = []

  const raw = await groqChat(
    [
      { role: 'system', content: RECAP_PROMPT },
      { role: 'user', content: memoryText },
    ],
    { jsonMode: true, timeoutMs: 5000, maxTokens: 400, temperature: 0.7 }
  )

  if (raw) {
    try {
      const cleaned = stripFences(raw)
      const p = JSON.parse(cleaned)
      // New Mind Engine format: { radar: { title, truth }, debt: [], catalyst: "" }
      if (p.radar || p.debt || p.catalyst) {
        const radarTitle = p.radar?.title ? String(p.radar.title).slice(0, 200) : ''
        const radarTruth = p.radar?.truth ? String(p.radar.truth).slice(0, 300) : ''
        const debtItems = Array.isArray(p.debt) ? p.debt.filter((s: unknown) => typeof s === 'string').slice(0, 3).map((s: string) => s.slice(0, 200)) : []
        const catalyst = p.catalyst ? String(p.catalyst).slice(0, 300) : ''

        // Map to the frontend's distillation + insights format
        distillation = radarTruth || `Your mind spent today on: ${radarTitle}`
        insights = [
          radarTitle ? `🎯 ${radarTitle}` : '',
          radarTruth ? `Harsh truth: ${radarTruth}` : '',
          ...debtItems.map((d: string) => `🚨 ${d}`),
          catalyst ? `⚡ ${catalyst}` : '',
        ].filter(s => s.length > 0)
      } else if (typeof p.distillation === 'string') {
        // Old format fallback
        distillation = p.distillation.slice(0, 500)
        if (Array.isArray(p.insights)) insights = p.insights.filter((s: unknown) => typeof s === 'string').slice(0, 3)
      }
    } catch (err) {
      logger.warn('Aether · recap parse failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ success: true, stats: { total: totalCount ?? 0, captured: capturedToday, recalled: Math.min(totalCount ?? 0, 27) }, distillation, insights } satisfies RecapResponse)
}
