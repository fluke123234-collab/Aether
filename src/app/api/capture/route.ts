/**
 * Aether · Phase 3 — Non-blocking capture endpoint
 * ------------------------------------------------------------
 *  Step 1: Instantly insert the raw memory with placeholder metadata.
 *  Step 2: Return { success: true, id } immediately (~200ms feel).
 *  Step 3: After the response drops, run the single consolidated
 *          Gemini analysis and silently UPDATE the row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { analyzeMemoryText } from '@/lib/gemini'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: { content?: unknown; user_id?: unknown }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'invalid_json' },
      { status: 400 }
    )
  }

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const userId = typeof body.user_id === 'string' && body.user_id ? body.user_id : null

  if (!content) {
    return NextResponse.json(
      { success: false, error: 'empty_content' },
      { status: 400 }
    )
  }

  // ── Step 1: instant insert with placeholder metadata ──
  const { data, error } = await supabase
    .from('memories')
    .insert([
      {
        title: 'Capturing thought…',
        body: content,
        summary: '',
        category: 'idea',
        tags: ['capture'],
        processing: true,
        user_id: userId,
      },
    ])
    .select()
    .single()

  if (error || !data) {
    console.warn('Aether · capture insert failed:', error?.message)
    return NextResponse.json(
      { success: false, error: error?.message ?? 'insert_failed' },
      { status: 500 }
    )
  }

  const memoryId = data.id as string
  const insertedAt = Date.now()

  // ── Step 3: background enrichment, AFTER the response is sent ──
  after(async () => {
    try {
      const analysis = await analyzeMemoryText(content)

      const { error: updateError } = await supabase
        .from('memories')
        .update({
          title: analysis.title,
          summary: analysis.summary,
          tags: analysis.tags,
          processing: false,
        })
        .eq('id', memoryId)

      if (updateError) {
        console.warn('Aether · background update failed:', updateError.message)
        return
      }

      const elapsed = Date.now() - insertedAt
      console.info(
        `Aether · memory ${memoryId} enriched in ${elapsed}ms`
      )
    } catch (err) {
      // Never leave the row stuck "processing" — resolve with a fallback update.
      console.warn(
        'Aether · enrichment threw:',
        err instanceof Error ? err.message : err
      )
      await supabase
        .from('memories')
        .update({ processing: false })
        .eq('id', memoryId)
        .then(() => undefined, () => undefined)
    }
  })

  // ── Step 2: immediate response — the client settles instantly ──
  return NextResponse.json({ success: true, id: memoryId })
}
