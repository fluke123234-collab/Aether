/**
 * Aether · /api/track-view — increment a memory's resonance score
 * ------------------------------------------------------------
 * Called when a memory is surfaced as a reference inside AskAetherModal
 * or when the user focuses/opens a memory from the feed. Increments
 * `view_count` and stamps `last_viewed_at` so the Serendipity
 * "Resonance Anchor" can surface the most-resonant memory.
 *
 * Fire-and-forget: the client doesn't await or block on this.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function POST(req: NextRequest) {
  let body: { id?: unknown; source?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  const source = typeof body.source === 'string' ? body.source : 'unknown'
  if (!id) return NextResponse.json({ success: false, error: 'no_id' }, { status: 400 })

  // Skip temp (optimistic) IDs — they don't exist in the DB yet.
  if (id.startsWith('temp-')) return NextResponse.json({ success: true, skipped: true })

  const token = req.headers.get('authorization')?.startsWith('Bearer ')
    ? req.headers.get('authorization')!.slice(7)
    : null
  if (!token) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const userClient = createClient(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_ANON_KEY || 'placeholder-anon-key',
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  // Read-then-write increment (safe for this low-stakes counter).
  const { data: row, error: readError } = await userClient
    .from('memories')
    .select('view_count')
    .eq('id', id)
    .eq('user_id', authData.user.id)
    .single()

  if (readError || !row) {
    // Column may not exist yet (schema not migrated) — fail silently.
    return NextResponse.json({ success: true, skipped: true, reason: 'column_or_row_missing' })
  }

  const current = (row.view_count as number) ?? 0
  const { error: writeError } = await userClient
    .from('memories')
    .update({
      view_count: current + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', authData.user.id)

  if (writeError) {
    logger.warn('Aether · track-view write failed:', writeError.message)
    return NextResponse.json({ success: true, skipped: true, reason: writeError.message })
  }

  return NextResponse.json({ success: true, id, source })
}
