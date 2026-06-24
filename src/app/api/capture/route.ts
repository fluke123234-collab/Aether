/**
 * Aether · /api/capture — Clean Synchronous Multimodal Capture
 * ------------------------------------------------------------
 * Vercel Hobby 10s optimized. No sharp, no after(), no parallel calls.
 *
 * Flow:
 *  1. Insert row instantly (title: "Processing spatial context...")
 *  2. VLM analyzes the image directly (8s timeout, no compression)
 *  3. Split VLM output: Line 1 → title, Line 2 → tags, Line 3+ → body
 *  4. Update row with enriched data
 *
 * Total: ~5-8s — fits Vercel's 10s limit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { analyzeMemoryText } from '@/lib/gemini'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ── The unified ZAI instance (created once, reused) ──
let zaiInstance: Awaited<ReturnType<typeof import('z-ai-web-dev-sdk').default.create>> | null = null
async function getZai() {
  if (zaiInstance) return zaiInstance
  const ZAIModule = await import('z-ai-web-dev-sdk')
  zaiInstance = await ZAIModule.default.create()
  return zaiInstance
}

const VISION_PROMPT = `You are an infallible, micro-precision visual analysis core operating inside a quiet digital sanctuary. Look directly at the raw pixels provided.

Read and extract characters (OCR), interface components, hardware specifications, prices, labels, or structural layouts with absolute accuracy.

Your output response MUST follow this exact string split layout profile:
[Line 1: A clean, contextual title describing the asset in under 5 words]
[Line 2: Exactly 5 dense search tags formatted like 'tag1, tag2, tag3, tag4, tag5']
[Line 3+: A complete, deeply detailed narrative breakdown of everything printed or visible in the image]

Do not include any preamble, JSON, or markdown formatting. Just the raw text in the exact layout above.`

export async function POST(req: NextRequest) {
  let body: { content?: unknown; image?: unknown; audio?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const hasImage = typeof body.image === 'string' && body.image.startsWith('data:image/')
  const hasAudio = typeof body.audio === 'string' && body.audio.startsWith('data:audio')
  if (!content && !hasImage && !hasAudio) {
    return NextResponse.json({ success: false, error: 'empty_content' }, { status: 400 })
  }

  // ── Verify session ──
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })

  const userId = authData.user.id
  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── Step 1: INSTANT ROW CREATION ──
  const finalContent = content || (hasImage ? 'Image capture' : (hasAudio ? 'Voice note' : ''))
  const initialMetadata: Record<string, unknown> = {}
  if (hasImage && typeof body.image === 'string') initialMetadata.imageData = body.image
  if (hasAudio && typeof body.audio === 'string') initialMetadata.audioData = body.audio

  const { data, error } = await userClient.from('memories').insert([{
    title: hasImage ? 'Processing spatial context...' : 'Capturing thought…',
    body: finalContent, content: finalContent, summary: '',
    category: hasImage ? 'image' : 'note', tags: ['capture'],
    processing: true, user_id: userId,
    metadata: Object.keys(initialMetadata).length > 0 ? initialMetadata : null,
  }]).select().single()

  if (error || !data) {
    logger.warn('Aether · capture insert failed:', error?.message)
    return NextResponse.json({ success: false, error: error?.message ?? 'insert_failed' }, { status: 500 })
  }

  const memoryId = data.id as string

  // ════════════════════════════════════════════════════════════════
  // IMAGE PATH: Direct VLM call → split output → update row
  // ════════════════════════════════════════════════════════════════
  if (hasImage && typeof body.image === 'string') {
    try {
      const zai = await getZai()

      // ── Step 2: DIRECT VISION CALL (no compression, 8s timeout) ──
      const visionPromise = zai.chat.completions.createVision({
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: body.image } },
          ],
        }],
        thinking: { type: 'disabled' },
      })

      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
      const res = await Promise.race([visionPromise, timeoutPromise])

      if (res) {
        const rawOutput = res.choices?.[0]?.message?.content?.trim() || ''

        if (rawOutput) {
          // ── Step 3: SPLIT THE VLM OUTPUT ──
          const lines = rawOutput.split('\n').map((l: string) => l.trim()).filter(Boolean)

          let title = 'Image capture'
          let tags: string[] = ['image', 'capture', 'visual']
          let description = rawOutput

          if (lines.length >= 3) {
            // Line 1: title
            title = lines[0].slice(0, 80)
            // Line 2: tags (comma-separated)
            const tagLine = lines[1].toLowerCase()
            const parsedTags = tagLine.split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 5)
            if (parsedTags.length >= 2) tags = ['image', ...parsedTags.filter((t: string) => t !== 'image')].slice(0, 5)
            // Line 3+: full description
            description = lines.slice(2).join('\n')
          } else if (lines.length === 1) {
            title = lines[0].slice(0, 80)
          }

          // ── Step 4: SINGLE-PASS DATABASE INJECTION ──
          const body = `${content || 'Image capture'}\n\n[Image content: ${description}]`.slice(0, 1000)

          await userClient.from('memories').update({
            title, body, content: body,
            summary: description.slice(0, 280),
            tags, category: 'image', processing: false,
            metadata: {
              title, summary: description.slice(0, 280), tags, type: 'image',
              imageDescription: description,
              searchKeywords: tags,
              imageData: body.image,
            },
          }).eq('id', memoryId)

          logger.info(`SUCCESS: Image memory ${memoryId} enriched — title: "${title}"`)
          return NextResponse.json({ success: true, id: memoryId, enriched: true })
        }
      }

      // VLM timed out or returned empty — use fallback
      logger.warn('Aether · VLM timed out or empty for capture, using fallback')
    } catch (err) {
      logger.error('Aether · VLM error in capture:', err instanceof Error ? err.message : err)
    }

    // ── Fallback: VLM failed — store what we have ──
    await userClient.from('memories').update({
      title: content ? content.slice(0, 60) : 'Image capture',
      body: `${content || 'Image capture'}\n\n[Image content: A captured image. Ask Aether to analyze it.]`,
      summary: 'A captured image.', tags: ['image', 'capture', 'visual'],
      category: 'image', processing: false,
      metadata: { imageDescription: 'A captured image. Ask Aether to analyze it.' },
    }).eq('id', memoryId)

    return NextResponse.json({ success: true, id: memoryId })
  }

  // ════════════════════════════════════════════════════════════════
  // TEXT/AUDIO PATH: Text enrichment (3s timeout)
  // ════════════════════════════════════════════════════════════════
  const textForEnrichment = content || (hasAudio ? 'Voice note' : '')
  const aiResponseString = await Promise.race([
    analyzeMemoryText(textForEnrichment),
    new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({ title: textForEnrichment.slice(0, 60), summary: '', tags: ['capture'] })), 3000))
  ])

  try {
    const aiData = JSON.parse(aiResponseString) as { title?: unknown; summary?: unknown; tags?: unknown; body?: unknown }
    const title = typeof aiData.title === 'string' && aiData.title.trim() ? aiData.title.trim().slice(0, 80) : 'Untitled Thought'
    const summary = typeof aiData.summary === 'string' ? aiData.summary.trim().slice(0, 280) : ''
    let tags: string[] = Array.isArray(aiData.tags) ? aiData.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, 5) : []
    if (tags.length === 0) tags = hasAudio ? ['voice', 'capture', 'audio'] : ['capture', 'note']
    const correctedBody = typeof aiData.body === 'string' && aiData.body.trim() ? aiData.body.trim().slice(0, 500) : finalContent
    const memoryType = classifyMemoryType(correctedBody)
    const searchKeywords = extractKeywords(correctedBody, tags)

    const metadataObj: Record<string, unknown> = { title, summary, tags, type: memoryType, searchKeywords }
    if (hasAudio && typeof body.audio === 'string') metadataObj.audioData = body.audio

    await userClient.from('memories').update({
      metadata: metadataObj, title, body: correctedBody, content: correctedBody,
      summary, tags, category: memoryType, processing: false,
    }).eq('id', memoryId)

    return NextResponse.json({ success: true, id: memoryId, enriched: true })
  } catch (parseError) {
    logger.error('Enrichment parse failed:', parseError instanceof Error ? parseError.message : parseError)
    const fallbackTags = hasAudio ? ['voice', 'capture', 'audio'] : ['capture', 'note']
    await userClient.from('memories').update({
      processing: false, tags: fallbackTags, title: finalContent.slice(0, 60) || 'Untitled Thought',
      category: 'note',
    }).eq('id', memoryId)
    return NextResponse.json({ success: true, id: memoryId })
  }
}

function classifyMemoryType(text: string): string {
  const t = text.toLowerCase()
  if (/\b(work|job|career|office|meeting|project|deadline|client|boss|colleague|email|report|presentation|startup|company|business)\b/.test(t)) return 'work'
  if (/\b(money|budget|dollar|cost|price|spend|spent|save|invest|stock|tax|rent|loan|debt|income|salary|pay|bill|bank|bought)\b/.test(t)) return 'money'
  if (/\b(health|doctor|gym|workout|exercise|run|sleep|diet|eat|food|weight|sick|medicine|therapy|mental|anxiety|stress|tired)\b/.test(t)) return 'health'
  if (/\b(idea|what if|concept|imagine|brainstorm|could be|might be|product|app|feature|design|build|create|invent)\b/.test(t)) return 'ideas'
  if (/\b(family|friend|partner|wife|husband|girlfriend|boyfriend|mom|dad|mother|father|son|daughter|kid|relationship|love|date)\b/.test(t)) return 'relationships'
  if (/\b(todo|to-do|task|need to|must|should|have to|don'?t forget|remember to|finish|complete|ship|fix|call|send|buy|schedule|book)\b/.test(t)) return 'task'
  return 'personal'
}

function extractKeywords(content: string, existingTags: string[]): string[] {
  const text = content.toLowerCase()
  const keywords = new Set<string>(existingTags.map((t) => t.toLowerCase()))
  const stopwords = new Set(['the', 'this', 'that', 'with', 'have', 'will', 'been', 'from', 'they', 'were', 'your', 'what', 'when', 'which', 'their', 'would', 'about', 'there', 'could', 'other', 'more', 'some', 'than', 'very', 'into', 'only', 'also', 'just', 'like', 'make', 'well', 'much', 'such', 'those', 'these', 'know', 'think', 'want', 'need', 'image', 'content', 'capture', 'note', 'voice'])
  const words = text.match(/\b[a-z]{4,}\b/g) || []
  const wordCounts = new Map<string, number>()
  for (const w of words) { if (stopwords.has(w)) continue; wordCounts.set(w, (wordCounts.get(w) || 0) + 1) }
  const sorted = Array.from(wordCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w)
  for (const w of sorted) keywords.add(w)
  return Array.from(keywords).slice(0, 15)
}
