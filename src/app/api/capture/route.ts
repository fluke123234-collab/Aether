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

  // ── Step 2: do enrichment SYNCHRONOUSLY (after() may not run on Vercel) ──
  // Run image analysis + text enrichment IN PARALLEL for speed.
  // Use 4s timeouts to stay within Vercel's 10s function limit.
  const imagePromise = (hasImage && typeof body.image === 'string')
    ? Promise.race([
        analyzeImage(body.image).catch(() => ''),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 4000))
      ])
    : Promise.resolve('')

  const textForEnrichment = content || (hasImage ? 'Image capture' : (hasAudio ? 'Voice note' : ''))
  const enrichmentPromise = Promise.race([
    analyzeMemoryText(textForEnrichment),
    new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({ title: textForEnrichment.slice(0, 60), summary: '', tags: ['capture'] })), 4000))
  ])

  // Wait for both in parallel.
  const [imageDescription, aiResponseString] = await Promise.all([
    imagePromise,
    enrichmentPromise,
  ])

  // If we got an image description, re-enrich with the full context.
  let finalAiResponse = aiResponseString
  if (imageDescription) {
    const fullText = [content, `[Image content: ${imageDescription}]`].filter(Boolean).join('\n\n')
    finalAiResponse = await analyzeMemoryText(fullText)
  }

  logger.info('AI enrichment output:', finalAiResponse)

  // Parse and apply the enrichment.
  try {
    const aiData = JSON.parse(finalAiResponse) as {
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
    // Use AI-corrected body if available, otherwise keep the original.
    const correctedBody =
      typeof aiData.body === 'string' && aiData.body.trim()
        ? aiData.body.trim().slice(0, 500)
        : finalContent

    const memoryType = hasImage ? 'image' : classifyMemoryType(correctedBody)
    const allContent = [correctedBody, imageDescription].filter(Boolean).join(' ')
    const searchKeywords = extractKeywords(allContent, tags)

    const metadataObj: Record<string, unknown> = {
      title, summary, tags, type: memoryType,
      imageDescription: imageDescription || undefined,
      searchKeywords,
    }
    if (hasImage && typeof body.image === 'string') metadataObj.imageData = body.image
    if (hasAudio && typeof body.audio === 'string') metadataObj.audioData = body.audio

    // Update the row with enriched data — including corrected body.
    await userClient
      .from('memories')
      .update({
        metadata: metadataObj,
        title,
        body: correctedBody,
        content: correctedBody,
        summary,
        tags,
        category: memoryType,
        processing: false,
      })
      .eq('id', memoryId)

    const elapsed = Date.now() - insertedAt
    logger.info(`SUCCESS: Memory enriched in ${elapsed}ms`)

    // Return the enriched memory directly — no need for client refetch.
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

  // ── Step 3: response ──
  return NextResponse.json({ success: true, id: memoryId })
}

/* ── Analyze an image via the z-ai-web-dev-sdk VLM (createVision) ── */
async function analyzeImage(imageDataUrl: string): Promise<string> {
  const VLM_PROMPT = `Analyze this image within the context of a personal thought sanctuary. Act as a cognitive extension. Do not just list items. Extract handwritten text (OCR), identify the emotional vibe, describe any background notes, documents, or scenery, and generate a dense list of relational keywords. Return a comprehensive text summary that will be stored directly inside the memory's embedding vector so it can be perfectly retrieved via semantic natural language search later.

Structure your response as:
1. OCR TEXT: Transcribe every word, number, label, price, heading, and handwritten note visible. Preserve exact figures.
2. SCENE & CONTENT: What is shown — products, documents, receipts, screenshots, diagrams, photos, scenery? Describe each item with its details (name, price, specs, quantities, colors, textures).
3. EMOTIONAL VIBE: The mood or feeling the image conveys (e.g., "calm minimalism", "urgent clutter", "warm nostalgia"). One phrase.
4. RELATIONAL KEYWORDS: 8-15 dense keywords and short phrases that capture concepts, objects, themes, and entities — optimized for semantic search retrieval.
5. SEMANTIC SUMMARY: 2-3 sentences weaving the content, vibe, and key entities into a rich narrative description.

Output plain text, no JSON. Be exhaustive and relational — this text will be embedded for natural language search.`

  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    // Construct directly — bypasses ZAI.create() which reads from a config
    // file that doesn't exist on Vercel.
    const zai = new ZAI({
      baseUrl: process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1',
      apiKey: process.env.ZAI_API_KEY || 'Z.ai',
      token: process.env.ZAI_TOKEN || '',
      chatId: process.env.ZAI_CHAT_ID || '',
      userId: process.env.ZAI_USER_ID || '',
    })
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

/* ── Extract hidden search keywords from all content ── */
function extractKeywords(content: string, existingTags: string[]): string[] {
  const text = content.toLowerCase()
  const keywords = new Set<string>(existingTags.map((t) => t.toLowerCase()))

  // Extract all words 4+ chars, filter stopwords.
  const stopwords = new Set(['the', 'this', 'that', 'with', 'have', 'will', 'been', 'from', 'they', 'were', 'your', 'what', 'when', 'which', 'their', 'would', 'about', 'there', 'could', 'other', 'more', 'some', 'than', 'very', 'into', 'only', 'also', 'just', 'like', 'make', 'well', 'much', 'such', 'those', 'these', 'know', 'think', 'want', 'need', 'image', 'content', 'capture', 'note', 'voice'])
  const words = text.match(/\b[a-z]{4,}\b/g) || []
  const wordCounts = new Map<string, number>()
  for (const w of words) {
    if (stopwords.has(w)) continue
    wordCounts.set(w, (wordCounts.get(w) || 0) + 1)
  }

  // Sort by frequency, take top 10.
  const sorted = Array.from(wordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w)
  for (const w of sorted) keywords.add(w)

  // Also extract any numbers/prices found in the text.
  const prices = text.match(/\$\d[\d,]*(?:\.\d+)?|\d[\d,]*\s*(?:dollars?|usd|k\b)/g) || []
  for (const p of prices) keywords.add(p.replace(/\s+/g, ''))

  return Array.from(keywords).slice(0, 15)
}
