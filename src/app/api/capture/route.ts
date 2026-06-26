/**
 * Aether · /api/capture — Non-blocking capture endpoint
 * ------------------------------------------------------------
 *  Step 1: Verify the Supabase session server-side (Bearer token).
 *  Step 2: Instantly insert the raw memory with the verified user_id.
 *  Step 3: Run AI enrichment (Groq text + vision + Whisper audio) in parallel.
 *  Step 4: Update the row with enriched data and return.
 *
 *  AI providers (all via Groq public API — works on Vercel):
 *    • Text enrichment  → llama-3.3-70b-versatile
 *    • Image analysis   → llama-4-scout-17b-16e-instruct
 *    • Audio transcript → whisper-large-v3
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { analyzeMemoryText } from '@/lib/gemini'
import { groqVision, groqTranscribe } from '@/lib/ai'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const VLM_PROMPT = `Analyze this image with extreme detail and accuracy. This is critical — be thorough.

1. EXTRACT ALL TEXT: Every word, number, price, label, spec, title, heading visible in the image. Transcribe verbatim, preserving exact numbers and prices.
2. DESCRIBE CONTENT: What is shown? Products, parts, documents, receipts, screenshots, diagrams? List each item with its details (name, price, specs, quantities).
3. KEYWORDS: List 5-10 keywords that describe this image (for searchability).
4. SUMMARIZE: One sentence summary of what this image contains.

Output plain text, no JSON. Be exhaustive — every detail matters. If there are prices, list them. If there are part names, list them. If there are specs, list them.`

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
        summary: '',
        category: hasImage ? 'image' : 'note',
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

  // ── Step 2: run AI analysis IN PARALLEL for speed ──
  // Audio transcription, image analysis, and text enrichment all run
  // concurrently. Each has a 5s timeout to stay within Vercel's 10s limit.
  const audioPromise = (hasAudio && typeof body.audio === 'string')
    ? Promise.race([
        groqTranscribe(body.audio, { timeoutMs: 5000 }),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 5000))
      ])
    : Promise.resolve('')

  const imagePromise = (hasImage && typeof body.image === 'string')
    ? Promise.race([
        groqVision(VLM_PROMPT, body.image, { timeoutMs: 5000 }),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 5000))
      ])
    : Promise.resolve('')

  // Wait for audio + image in parallel.
  const [transcription, imageDescription] = await Promise.all([
    audioPromise,
    imagePromise,
  ])

  // Build the enrichment text from all available sources.
  const enrichmentParts: string[] = []
  if (content) enrichmentParts.push(content)
  if (transcription) enrichmentParts.push(`[Voice transcription: ${transcription}]`)
  if (imageDescription) enrichmentParts.push(`[Image content: ${imageDescription}]`)
  const textForEnrichment = enrichmentParts.join('\n\n') || finalContent

  // Run text enrichment on the combined content.
  const enrichmentPromise = Promise.race([
    analyzeMemoryText(textForEnrichment),
    new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({
      title: textForEnrichment.slice(0, 60),
      summary: '',
      tags: ['capture'],
      body: textForEnrichment.slice(0, 500),
    })), 5000))
  ])

  const aiResponseString = await enrichmentPromise

  logger.info('AI enrichment output:', aiResponseString)

  // Parse and apply the enrichment.
  try {
    const aiData = JSON.parse(aiResponseString) as {
      title?: unknown
      summary?: unknown
      tags?: unknown
      body?: unknown
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
    // Use AI-corrected body if available, otherwise use transcription/content.
    const correctedBody =
      typeof aiData.body === 'string' && aiData.body.trim()
        ? aiData.body.trim().slice(0, 500)
        : (transcription || finalContent)

    const memoryType = hasImage ? 'image' : (hasAudio ? 'voice' : classifyMemoryType(correctedBody))
    const allContent = [correctedBody, imageDescription].filter(Boolean).join(' ')
    const searchKeywords = extractKeywords(allContent, tags)

    const metadataObj: Record<string, unknown> = {
      title, summary, tags, type: memoryType,
      imageDescription: imageDescription || undefined,
      transcription: transcription || undefined,
      searchKeywords,
    }
    if (hasImage && typeof body.image === 'string') metadataObj.imageData = body.image
    if (hasAudio && typeof body.audio === 'string') metadataObj.audioData = body.audio

    // Update the row with enriched data.
    await userClient
      .from('memories')
      .update({
        metadata: metadataObj,
        title,
        body: correctedBody,
        summary,
        tags,
        category: memoryType,
        processing: false,
      })
      .eq('id', memoryId)

    const elapsed = Date.now() - insertedAt
    logger.info(`SUCCESS: Memory enriched in ${elapsed}ms`)

    return NextResponse.json({ success: true, id: memoryId, enriched: true })
  } catch (parseError) {
    logger.error('Enrichment parse failed:', parseError instanceof Error ? parseError.message : parseError)
    // Mark as not processing so it doesn't hang.
    await userClient
      .from('memories')
      .update({ processing: false })
      .eq('id', memoryId)
      .then(() => undefined, () => undefined)
  }

  return NextResponse.json({ success: true, id: memoryId })
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

/* ── Extract hidden search keywords from all content ── */
function extractKeywords(content: string, existingTags: string[]): string[] {
  const text = content.toLowerCase()
  const keywords = new Set<string>(existingTags.map((t) => t.toLowerCase()))

  const stopwords = new Set(['the', 'this', 'that', 'with', 'have', 'will', 'been', 'from', 'they', 'were', 'your', 'what', 'when', 'which', 'their', 'would', 'about', 'there', 'could', 'other', 'more', 'some', 'than', 'very', 'into', 'only', 'also', 'just', 'like', 'make', 'well', 'much', 'such', 'those', 'these', 'know', 'think', 'want', 'need', 'image', 'content', 'capture', 'note', 'voice'])
  const words = text.match(/\b[a-z]{4,}\b/g) || []
  const wordCounts = new Map<string, number>()
  for (const w of words) {
    if (stopwords.has(w)) continue
    wordCounts.set(w, (wordCounts.get(w) || 0) + 1)
  }

  const sorted = Array.from(wordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w)
  for (const w of sorted) keywords.add(w)

  const prices = text.match(/\$\d[\d,]*(?:\.\d+)?|\d[\d,]*\s*(?:dollars?|usd|k\b)/g) || []
  for (const p of prices) keywords.add(p.replace(/\s+/g, ''))

  return Array.from(keywords).slice(0, 15)
}
