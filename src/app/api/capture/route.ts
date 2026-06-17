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
import { logger } from '@/lib/logger'

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
        metadata: null,
      },
    ])
    .select()
    .single()

  if (error || !data) {
    logger.warn('Aether · capture insert failed:', error?.message)
    return NextResponse.json(
      { success: false, error: error?.message ?? 'insert_failed' },
      { status: 500 }
    )
  }

  const memoryId = data.id as string
  const insertedAt = Date.now()

  // ── Step 3: background enrichment, AFTER the response is sent ──
  after(async () => {
    // 1. Await the consolidated Gemini analysis payload (a JSON string).
    const aiResponseString = await analyzeMemoryText(content)

    // AUDIT: trace the raw payload before parsing so failures are visible.
    logger.info('Gemini Raw Output:', aiResponseString)

    try {
      // 2. Safely parse the response string into a clean object.
      const aiData = JSON.parse(aiResponseString) as {
        title?: unknown
        summary?: unknown
        tags?: unknown
      }

      // Normalise — never let undefined fields overwrite the row.
      const title =
        typeof aiData.title === 'string' && aiData.title.trim()
          ? aiData.title.trim().slice(0, 80)
          : 'Untitled Thought'
      const summary =
        typeof aiData.summary === 'string' ? aiData.summary.trim().slice(0, 280) : ''
      const tags: string[] = Array.isArray(aiData.tags)
        ? aiData.tags
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.trim())
            .slice(0, 3)
        : []

      // 3. Update the exact database row matching the memory ID.
      //    Map the AI payload into the `metadata` JSONB column (the canonical
      //    store for AI-derived fields) AND mirror onto the top-level columns
      //    so the existing feed/cards keep rendering without a schema migration.
      const { error } = await supabase
        .from('memories')
        .update({
          metadata: { title, summary, tags },
          title,
          summary,
          tags,
          processing: false,
        })
        .eq('id', memoryId)

      if (error) {
        logger.error('SUPABASE UPDATE ERROR:', error.message)
        // Never leave the row stuck "processing".
        await supabase
          .from('memories')
          .update({ processing: false })
          .eq('id', memoryId)
          .then(() => undefined, () => undefined)
        return
      }

      const elapsed = Date.now() - insertedAt
      logger.info(
        `SUCCESS: Memory metadata successfully synced to database. (${memoryId} in ${elapsed}ms)`
      )
    } catch (parseError) {
      logger.error(
        'CRITICAL CRASH: Failed to parse Gemini response string. Raw payload was:',
        aiResponseString,
        parseError instanceof Error ? parseError.message : parseError
      )
      // Resolve the row so it never hangs in "processing".
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
