/** Aether · /api/delete — delete a memory (user-scoped) */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null
  if (!token) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })

  let body: { id?: unknown }; try { body = await req.json() } catch { return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 }) }
  const memoryId = typeof body.id === 'string' ? body.id : ''
  if (!memoryId) return NextResponse.json({ success: false, error: 'missing_id' }, { status: 400 })

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { error } = await userClient.from('memories').delete().eq('id', memoryId).eq('user_id', authData.user.id)
  if (error) { logger.warn('Aether · delete failed:', error.message); return NextResponse.json({ success: false, error: error.message }, { status: 500 }) }
  return NextResponse.json({ success: true })
}
