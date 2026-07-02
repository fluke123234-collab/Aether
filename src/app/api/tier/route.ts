import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserTier, type TierInfo } from '@/lib/tier'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null
  if (!token) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  try { const info: TierInfo = await getUserTier(authData.user.id, token); return NextResponse.json({ success: true, ...info }) }
  catch (err) { return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'unknown' }, { status: 500 }) }
}
