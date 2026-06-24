/** Aether · /api/insight — deeper AI reflection on a single memory */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const INSIGHT_PROMPT = `You are Aether — a sharp, insightful companion. The user kept a thought and wants you to see something in it they might have missed. Give them a GENUINELY useful reflection, not generic wisdom. BE SPECIFIC TO THE ACTUAL CONTENT. Surface an assumption, find a tension, offer a reframe, or ask a sharper question. Output valid raw JSON only: {"angle":"2-4 word label","insight":"4-7 sentence reflection, second person, specific, end with a sharp question."}`

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null
  if (!token) return NextResponse.json({ success: false, insight: '', angle: '', error: 'unauthorized' }, { status: 401 })
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, insight: '', angle: '', error: 'unauthorized' }, { status: 401 })

  let body: { id?: unknown }; try { body = await req.json() } catch { return NextResponse.json({ success: false, insight: '', angle: '', error: 'invalid_json' }, { status: 400 }) }
  const memoryId = typeof body.id === 'string' ? body.id : ''
  if (!memoryId) return NextResponse.json({ success: false, insight: '', angle: '', error: 'missing_id' }, { status: 400 })

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: memory, error } = await userClient.from('memories').select('title, body, summary, tags, created_at').eq('id', memoryId).eq('user_id', authData.user.id).single()
  if (error || !memory) return NextResponse.json({ success: false, insight: '', angle: '', error: 'not_found' }, { status: 404 })

  const memoryText = `${memory.title || 'Untitled'}\n\n${memory.body || ''}`
  let insight = 'Sometimes the act of keeping a thought is the insight itself.'
  let angle = 'A gentler look'

  // Use Groq text model (llama-3.3-70b-versatile)
  try {
    const { geminiText, stripFences } = await import('@/lib/gemini-ai')
    const raw = await geminiText([
      { role: 'system', content: INSIGHT_PROMPT },
      { role: 'user', content: memoryText },
    ], 7000)

    if (raw) {
      try {
        const p = JSON.parse(stripFences(raw))
        if (typeof p.angle === 'string') angle = p.angle.slice(0, 60)
        if (typeof p.insight === 'string') insight = p.insight.slice(0, 800)
      } catch {
        insight = raw.slice(0, 800)
      }
    }
  } catch (err) {
    logger.warn('Aether · insight failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ success: true, insight, angle })
}
