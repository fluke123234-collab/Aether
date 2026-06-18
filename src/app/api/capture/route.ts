/**
 * Aether · Non-blocking capture endpoint
 * ------------------------------------------------------------
 *  Step 1: Verify the Supabase session server-side (Bearer token).
 *          If no valid session → 401, insert nothing.
 *  Step 2: Instantly insert the raw memory with the verified user_id.
 *  Step 3: Return { success: true, id } immediately (~200ms feel).
 *  Step 4: After the response drops, run the AI analysis + image VLM
 *          and silently UPDATE the row.
 *
 *  Never trusts a client-sent user_id. Uses a user-authenticated
 *  Supabase client so RLS (auth.uid() = user_id) passes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { analyzeMemoryText } from '@/lib/gemini'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const ZAI_API_KEY = process.env.ZAI_API_KEY || ''
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1'

export async function POST(req: NextRequest) {
  let body: { content?: unknown; image?: unknown; audio?: unknown }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const hasImage = typeof body.image === 'string' && body.image.startsWith('data:image/')
  const hasAudio = typeof body.audio === 'string' && body.audio.startsWith('data:audio')

  if (!content && !hasImage && !hasAudio) {
    return NextResponse.json({ success: false, error: 'empty_content' }, { status: 400 })
  }

  // ── Verify the Supabase session server-side ──
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const userId = authData.user.id

  // ── User-authenticated client so RLS passes ──
  const userClient = createClient(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_ANON_KEY || 'placeholder-anon-key',
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  // ── Step 1: instant insert with placeholder metadata + verified user_id ──
  const finalContent = content || (hasImage ? 'Image capture' : (hasAudio ? 'Voice note' : ''))
  const initialMetadata: Record<string, unknown> | null = {}
  if (hasImage && typeof body.image === 'string') initialMetadata.imageData = body.image
  if (hasAudio && typeof body.audio === 'string') initialMetadata.audioData = body.audio

  const { data, error } = await userClient
    .from('memories')
    .insert([
      {
        title: 'Capturing thought…',
        body: finalContent,
        content: finalContent,
        summary: '',
        category: hasImage ? 'image' : (hasAudio ? 'note' : 'note'),
        tags: ['capture'],
        processing: true,
        user_id: userId,
        metadata: Object.keys(initialMetadata).length > 0 ? initialMetadata : null,
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

  // ── Step 4: background enrichment, AFTER the response is sent ──
  after(async () => {
    // If an image was attached, analyze it via VLM first.
    let imageDescription = ''
    if (hasImage && typeof body.image === 'string') {
      try {
        imageDescription = await analyzeImage(body.image)
      } catch (err) {
        logger.warn('Aether · image analysis failed:', err instanceof Error ? err.message : err)
      }
    }

    // The text the AI enriches: the user's note + the image description.
    const enrichmentText = [content, imageDescription ? `[Image content: ${imageDescription}]` : '']
      .filter(Boolean)
      .join('\n\n')

    // 1. Await the consolidated AI analysis payload (a JSON string).
    const aiResponseString = await analyzeMemoryText(enrichmentText || imageDescription || finalContent)

    logger.info('Gemini Raw Output:', aiResponseString)

    try {
      const aiData = JSON.parse(aiResponseString) as {
        title?: unknown
        summary?: unknown
        tags?: unknown
      }

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

      // Auto-classify the memory type (life area).
      const memoryType = classifyMemoryType(enrichmentText || content)

      // Smart connections: find related past memories.
      let connections: string[] = []
      try {
        const { data: pastMemories } = await userClient
          .from('memories')
          .select('id, title, body, tags')
          .eq('user_id', userId)
          .neq('id', memoryId)
          .order('created_at', { ascending: false })
          .limit(30)

        if (pastMemories && pastMemories.length > 0) {
          const newWords = (enrichmentText || content).toLowerCase().split(/\s+/).filter((w) => w.length > 4)
          const newTags = tags.map((t) => t.toLowerCase())
          connections = pastMemories
            .filter((m) => {
              const pastText = (m.title + ' ' + m.body + ' ' + (m.tags ?? []).join(' ')).toLowerCase()
              const tagMatch = (m.tags ?? []).some((t) => newTags.includes(t.toLowerCase()))
              const wordMatches = newWords.filter((w) => pastText.includes(w)).length
              return tagMatch || wordMatches >= 2
            })
            .slice(0, 3)
            .map((m) => m.id)
        }
      } catch {
        // Non-critical.
      }

      // 3. Update the row with enriched data — preserve image + audio data.
      const metadataObj: Record<string, unknown> = {
        title, summary, tags, type: memoryType, connections,
        imageDescription: imageDescription || undefined,
      }
      // Preserve the original image data so the card can display it.
      if (hasImage && typeof body.image === 'string') {
        metadataObj.imageData = body.image
      }
      // Preserve the original audio data so the card can play it back.
      if (hasAudio && typeof body.audio === 'string') {
        metadataObj.audioData = body.audio
      }

      const { error } = await userClient
        .from('memories')
        .update({
          metadata: metadataObj,
          title,
          summary,
          tags,
          category: memoryType,
          processing: false,
        })
        .eq('id', memoryId)

      if (error) {
        logger.error('SUPABASE UPDATE ERROR:', error.message)
        await userClient
          .from('memories')
          .update({ processing: false })
          .eq('id', memoryId)
          .then(() => undefined, () => undefined)
        return
      }

      const elapsed = Date.now() - insertedAt
      logger.info(`SUCCESS: Memory metadata synced. (${memoryId} in ${elapsed}ms)`)
    } catch (parseError) {
      logger.error('CRITICAL CRASH: Failed to parse AI response. Raw:', aiResponseString, parseError instanceof Error ? parseError.message : parseError)
      await userClient
        .from('memories')
        .update({ processing: false })
        .eq('id', memoryId)
        .then(() => undefined, () => undefined)
    }
  })

  // ── Step 3: immediate response ──
  return NextResponse.json({ success: true, id: memoryId })
}

/* ── Analyze an image via the z-ai-web-dev-sdk VLM (createVision) ── */
async function analyzeImage(imageDataUrl: string): Promise<string> {
  const VLM_PROMPT = `Analyze this image with extreme detail and accuracy. This is critical — be thorough.

1. EXTRACT ALL TEXT: Every word, number, price, label, spec, title, heading visible in the image. Transcribe verbatim, preserving exact numbers and prices.
2. DESCRIBE CONTENT: What is shown? Products, parts, documents, receipts, screenshots, diagrams? List each item with its details (name, price, specs, quantities).
3. SUMMARIZE: One sentence summary of what this image contains.

Output plain text, no JSON. Be exhaustive — every detail matters. If there are prices, list them. If there are part names, list them. If there are specs, list them.`

  // The Z.ai direct API doesn't support image_url content type — only the
  // z-ai-web-dev-sdk's createVision method works for image analysis.
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const res = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VLM_PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    return res.choices[0]?.message?.content ?? ''
  } catch (err) {
    logger.warn('Aether · VLM (SDK) failed:', err instanceof Error ? err.message : err)
    return ''
  }
}

/* ── Auto-classify a memory into a life area ── */
function classifyMemoryType(text: string): string {
  const t = text.toLowerCase()
  if (/\b(work|job|career|office|meeting|project|deadline|client|boss|colleague|email|report|presentation|startup|company|business)\b/.test(t)) return 'work'
  if (/\b(money|budget|dollar|cost|price|spend|spent|save|invest|stock|tax|rent|loan|debt|income|salary|pay|bill|bank|bought)\b/.test(t)) return 'money'
  if (/\b(health|doctor|gym|workout|exercise|run|sleep|diet|eat|food|weight|sick|medicine|therapy|mental|anxiety|stress|tired)\b/.test(t)) return 'health'
  if (/\b(idea|what if|concept|imagine|brainstorm|could be|might be|product|app|feature|design|build|create|invent)\b/.test(t)) return 'ideas'
  if (/\b(family|friend|partner|wife|husband|girlfriend|boyfriend|mom|dad|mother|father|son|daughter|kid|relationship|love|date)\b/.test(t)) return 'relationships'
  if (/\b(todo|to-do|task|need to|must|should|have to|don'?t forget|remember to|finish|complete|ship|fix|call|send|buy|schedule|book)\b/.test(t)) return 'task'
  if (t.includes('image capture') || t.startsWith('[image content:')) return 'image'
  return 'personal'
}
