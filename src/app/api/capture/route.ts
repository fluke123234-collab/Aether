/**
 * Aether · Instant capture endpoint
 * ------------------------------------------------------------
 * Step 1: Verify session → insert row → RETURN IMMEDIATELY (~200ms)
 * Step 2: Run VLM + text enrichment in the BACKGROUND using after()
 *          (Vercel's after() API runs after the response is sent)
 *
 * This fixes the Vercel Hobby plan 10s timeout — the user gets an
 * instant response, and the AI enrichment happens silently in the
 * background. The frontend's refetch() picks up the enriched row
 * a few seconds later.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { analyzeMemoryText } from '@/lib/gemini'
import { analyzeImageWithCLI } from '@/lib/vlm'
import { logger } from '@/lib/logger'
import { after } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

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

  // ── Step 1: INSTANT insert with placeholder + verified user_id ──
  const finalContent = content || (hasImage ? 'Image capture' : (hasAudio ? 'Voice note' : ''))
  const initialMetadata: Record<string, unknown> = {}
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
  const imageBase64 = hasImage && typeof body.image === 'string' ? body.image : ''
  const audioBase64 = hasAudio && typeof body.audio === 'string' ? body.audio : ''

  // ── RETURN IMMEDIATELY — the user sees their thought instantly ──
  // The frontend will refetch in 2-3 seconds to pick up the enriched version.

  // ── Step 2: BACKGROUND ENRICHMENT using after() ──
  // after() runs after the response is sent to the client.
  // On Vercel, after() gets the full function duration to finish.
  after(enrichMemory(
    userClient,
    memoryId,
    userId,
    content,
    finalContent,
    imageBase64,
    audioBase64,
    hasImage,
    hasAudio
  ))

  return NextResponse.json({ success: true, id: memoryId })
}

// ════════════════════════════════════════════════════════════════
// BACKGROUND ENRICHMENT — runs after the response is sent
// ════════════════════════════════════════════════════════════════
async function enrichMemory(
  userClient: ReturnType<typeof createClient>,
  memoryId: string,
  userId: string,
  content: string,
  finalContent: string,
  imageBase64: string,
  audioBase64: string,
  hasImage: boolean,
  hasAudio: boolean
) {
  const startTime = Date.now()

  try {
    // ── Run VLM + text enrichment IN PARALLEL ──
    const imagePromise = hasImage && imageBase64
      ? Promise.race([
          analyzeImage(imageBase64).catch(() => ''),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 20000))
        ])
      : Promise.resolve('')

    const textForEnrichment = content || (hasImage ? 'Image capture' : (hasAudio ? 'Voice note' : ''))
    const enrichmentPromise = Promise.race([
      analyzeMemoryText(textForEnrichment),
      new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({ title: textForEnrichment.slice(0, 60), summary: '', tags: ['capture'] })), 12000))
    ])

    const [imageDescription, aiResponseString] = await Promise.all([
      imagePromise,
      enrichmentPromise,
    ])

    // If we got an image description, generate title+tags FROM the image content.
    let finalAiResponse = aiResponseString
    if (imageDescription) {
      const fullText = [content, `[Image content: ${imageDescription}]`].filter(Boolean).join('\n\n')
      const reEnriched = await Promise.race([
        analyzeMemoryText(fullText),
        new Promise<string>((resolve) => setTimeout(() => resolve(aiResponseString), 12000))
      ])
      finalAiResponse = reEnriched
    } else if (hasImage && !content) {
      finalAiResponse = JSON.stringify({
        title: 'Image capture',
        summary: 'A captured image. The vision analysis could not be completed at capture time — ask Aether about it later for a live analysis.',
        tags: ['image', 'capture', 'visual'],
        body: 'Image capture',
      })
    }

    logger.info('AI enrichment output:', finalAiResponse)

    // Parse and apply the enrichment.
    try {
      const aiData = JSON.parse(finalAiResponse) as {
        title?: unknown; summary?: unknown; tags?: unknown; body?: unknown
      }

      const title =
        typeof aiData.title === 'string' && aiData.title.trim() && aiData.title.trim() !== 'Image capture'
          ? aiData.title.trim().slice(0, 80)
          : (hasImage && imageDescription
            ? imageDescription.slice(0, 60).trim().replace(/\s+/g, ' ')
            : (hasImage ? 'Image capture' : 'Untitled Thought'))
      const summary = typeof aiData.summary === 'string' ? aiData.summary.trim().slice(0, 280) : ''
      let tags: string[] = Array.isArray(aiData.tags)
        ? aiData.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, 5)
        : []
      if (hasImage && !tags.includes('image')) tags = ['image', ...tags].slice(0, 5)
      if (tags.length === 0) tags = hasImage ? ['image', 'capture', 'visual'] : (hasAudio ? ['voice', 'capture', 'audio'] : ['capture', 'note'])

      let correctedBody =
        typeof aiData.body === 'string' && aiData.body.trim()
          ? aiData.body.trim().slice(0, 500)
          : finalContent

      // ── Double-anchor: embed VLM description into body text ──
      if (hasImage && imageDescription) {
        correctedBody = `${correctedBody}\n\n[Image content: ${imageDescription}]`.slice(0, 1000)
      }

      const memoryType = hasImage ? 'image' : classifyMemoryType(correctedBody)
      const allContent = [correctedBody, imageDescription].filter(Boolean).join(' ')
      const searchKeywords = extractKeywords(allContent, tags)

      const finalImageDescription = imageDescription || (hasImage
        ? 'A captured image. Use Ask Aether to analyze the actual content of this image.'
        : undefined)

      const metadataObj: Record<string, unknown> = {
        title, summary, tags, type: memoryType,
        imageDescription: finalImageDescription,
        searchKeywords,
      }
      if (hasImage && imageBase64) metadataObj.imageData = imageBase64
      if (hasAudio && audioBase64) metadataObj.audioData = audioBase64

      await userClient
        .from('memories')
        .update({
          metadata: metadataObj, title, body: correctedBody, content: correctedBody,
          summary, tags, category: memoryType, processing: false,
        })
        .eq('id', memoryId)

      logger.info(`SUCCESS: Memory ${memoryId} enriched in ${Date.now() - startTime}ms`)
    } catch (parseError) {
      logger.error('Enrichment parse failed:', parseError instanceof Error ? parseError.message : parseError)
      const fallbackTags = hasImage ? ['image', 'capture', 'visual'] : (hasAudio ? ['voice', 'capture', 'audio'] : ['capture', 'note'])
      const fallbackTitle = finalContent.slice(0, 60) || (hasImage ? 'Image capture' : 'Untitled Thought')
      await userClient.from('memories').update({
        processing: false, tags: fallbackTags, title: fallbackTitle,
        category: hasImage ? 'image' : 'note',
        metadata: { title: fallbackTitle, summary: '', tags: fallbackTags, type: hasImage ? 'image' : 'note', imageDescription: hasImage ? 'A captured visual asset.' : undefined },
      }).eq('id', memoryId)
    }
  } catch (err) {
    logger.error('Aether · background enrichment failed:', err instanceof Error ? err.message : err)
    // Ensure the row doesn't hang in processing state
    await userClient.from('memories').update({ processing: false }).eq('id', memoryId).then(() => undefined, () => undefined)
  }
}

/* ── Analyze an image via ZAI.create() + createVision() ── */
async function analyzeImage(imageDataUrl: string): Promise<string> {
  const VLM_PROMPT = `Analyze this image within the context of a personal thought sanctuary. Act as a cognitive extension. Do not just list items. Extract handwritten text (OCR), identify the emotional vibe, describe any background notes, documents, or scenery, and generate a dense list of relational keywords. Return a comprehensive text summary that will be stored directly inside the memory's embedding vector so it can be perfectly retrieved via semantic natural language search later.

Structure your response as:
1. OCR TEXT: Transcribe every word, number, label, price, heading, and handwritten note visible. Preserve exact figures.
2. SCENE & CONTENT: What is shown — products, documents, receipts, screenshots, diagrams, photos, scenery? Describe each item with its details.
3. EMOTIONAL VIBE: The mood or feeling the image conveys. One phrase.
4. RELATIONAL KEYWORDS: 8-15 dense keywords and short phrases.
5. SEMANTIC SUMMARY: 2-3 sentences weaving the content, vibe, and key entities.

Output plain text, no JSON. Be exhaustive and relational.`
  return analyzeImageWithCLI(imageDataUrl, VLM_PROMPT, 20000)
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
  for (const w of words) { if (stopwords.has(w)) continue; wordCounts.set(w, (wordCounts.get(w) || 0) + 1) }
  const sorted = Array.from(wordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w)
  for (const w of sorted) keywords.add(w)
  const prices = text.match(/\$\d[\d,]*(?:\.\d+)?|\d[\d,]*\s*(?:dollars?|usd|k\b)/g) || []
  for (const p of prices) keywords.add(p.replace(/\s+/g, ''))
  return Array.from(keywords).slice(0, 15)
}
