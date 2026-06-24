/**
 * Aether · Capture endpoint — Synchronous, fits Vercel's 10s Hobby limit
 * ------------------------------------------------------------
 * Timeline (target <9s total):
 *  1. Verify session + insert row: ~500ms
 *  2. VLM image analysis: 5s timeout
 *  3. Text enrichment: 3s timeout
 *  4. Update row: ~200ms
 *
 * after() is NOT used — it doesn't give extra time on Vercel Hobby.
 * Re-enrichment is SKIPPED — saves 3-8s, not worth the timeout risk.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { analyzeMemoryText } from '@/lib/gemini'
import { analyzeImageWithCLI } from '@/lib/vlm'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

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

  // ── Step 1: INSTANT insert ──
  const finalContent = content || (hasImage ? 'Image capture' : (hasAudio ? 'Voice note' : ''))
  const initialMetadata: Record<string, unknown> = {}
  if (hasImage && typeof body.image === 'string') initialMetadata.imageData = body.image
  if (hasAudio && typeof body.audio === 'string') initialMetadata.audioData = body.audio

  const { data, error } = await userClient.from('memories').insert([{
    title: 'Capturing thought…', body: finalContent, content: finalContent, summary: '',
    category: hasImage ? 'image' : 'note', tags: ['capture'], processing: true,
    user_id: userId, metadata: Object.keys(initialMetadata).length > 0 ? initialMetadata : null,
  }]).select().single()

  if (error || !data) {
    logger.warn('Aether · capture insert failed:', error?.message)
    return NextResponse.json({ success: false, error: error?.message ?? 'insert_failed' }, { status: 500 })
  }

  const memoryId = data.id as string

  // ── Step 2: SYNCHRONOUS enrichment (fits Vercel 10s limit) ──
  // VLM: 5s timeout, Text enrichment: 3s timeout — run in parallel
  const imageBase64 = hasImage && typeof body.image === 'string' ? body.image : ''

  const imagePromise = hasImage && imageBase64
    ? Promise.race([
        analyzeImage(imageBase64).catch(() => ''),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 5000))
      ])
    : Promise.resolve('')

  const textForEnrichment = content || (hasImage ? 'Image capture' : (hasAudio ? 'Voice note' : ''))
  const enrichmentPromise = Promise.race([
    analyzeMemoryText(textForEnrichment),
    new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({ title: textForEnrichment.slice(0, 60), summary: '', tags: ['capture'] })), 3000))
  ])

  const [imageDescription, aiResponseString] = await Promise.all([imagePromise, enrichmentPromise])

  // If we got an image description, use it for the title + tags (skip re-enrichment — saves time)
  let finalAiResponse = aiResponseString
  if (imageDescription) {
    // Use the image description directly for title + tags without a second API call
    const titleFromDesc = imageDescription.slice(0, 60).trim().replace(/\s+/g, ' ')
    finalAiResponse = JSON.stringify({
      title: titleFromDesc,
      summary: imageDescription.slice(0, 200),
      tags: ['image', 'capture', 'visual'],
      body: finalContent,
    })
  } else if (hasImage && !content) {
    finalAiResponse = JSON.stringify({
      title: 'Image capture',
      summary: 'A captured image. Ask Aether to analyze it.',
      tags: ['image', 'capture', 'visual'],
      body: 'Image capture',
    })
  }

  // ── Step 3: Update row with enriched data ──
  try {
    const aiData = JSON.parse(finalAiResponse) as { title?: unknown; summary?: unknown; tags?: unknown; body?: unknown }

    const title = typeof aiData.title === 'string' && aiData.title.trim()
      ? aiData.title.trim().slice(0, 80)
      : (hasImage ? 'Image capture' : 'Untitled Thought')
    const summary = typeof aiData.summary === 'string' ? aiData.summary.trim().slice(0, 280) : ''
    let tags: string[] = Array.isArray(aiData.tags)
      ? aiData.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, 5)
      : []
    if (hasImage && !tags.includes('image')) tags = ['image', ...tags].slice(0, 5)
    if (tags.length === 0) tags = hasImage ? ['image', 'capture', 'visual'] : (hasAudio ? ['voice', 'capture', 'audio'] : ['capture', 'note'])

    let correctedBody = typeof aiData.body === 'string' && aiData.body.trim()
      ? aiData.body.trim().slice(0, 500)
      : finalContent

    // ── Double-anchor: embed VLM description into body text ──
    if (hasImage && imageDescription) {
      correctedBody = `${correctedBody}\n\n[Image content: ${imageDescription}]`.slice(0, 1000)
    }

    const memoryType = hasImage ? 'image' : classifyMemoryType(correctedBody)
    const searchKeywords = extractKeywords([correctedBody, imageDescription].filter(Boolean).join(' '), tags)
    const finalImageDescription = imageDescription || (hasImage ? 'A captured image. Use Ask Aether to analyze the actual content of this image.' : undefined)

    const metadataObj: Record<string, unknown> = {
      title, summary, tags, type: memoryType,
      imageDescription: finalImageDescription, searchKeywords,
    }
    if (hasImage && imageBase64) metadataObj.imageData = imageBase64
    if (hasAudio && typeof body.audio === 'string') metadataObj.audioData = body.audio

    await userClient.from('memories').update({
      metadata: metadataObj, title, body: correctedBody, content: correctedBody,
      summary, tags, category: memoryType, processing: false,
    }).eq('id', memoryId)

    logger.info(`SUCCESS: Memory ${memoryId} enriched`)
    return NextResponse.json({ success: true, id: memoryId, enriched: true })
  } catch (parseError) {
    logger.error('Enrichment parse failed:', parseError instanceof Error ? parseError.message : parseError)
    const fallbackTags = hasImage ? ['image', 'capture', 'visual'] : (hasAudio ? ['voice', 'capture', 'audio'] : ['capture', 'note'])
    const fallbackTitle = finalContent.slice(0, 60) || (hasImage ? 'Image capture' : 'Untitled Thought')
    await userClient.from('memories').update({
      processing: false, tags: fallbackTags, title: fallbackTitle, category: hasImage ? 'image' : 'note',
      metadata: { title: fallbackTitle, summary: '', tags: fallbackTags, type: hasImage ? 'image' : 'note', imageDescription: hasImage ? 'A captured visual asset.' : undefined },
    }).eq('id', memoryId).then(() => undefined, () => undefined)
    return NextResponse.json({ success: true, id: memoryId })
  }
}

async function analyzeImage(imageDataUrl: string): Promise<string> {
  const VLM_PROMPT = `Analyze this image. Extract ALL visible text (OCR), identify all components, labels, specs, prices, and details. Describe what you see thoroughly. This text will be used for semantic search. Output plain text, no JSON.`
  return analyzeImageWithCLI(imageDataUrl, VLM_PROMPT, 5000)
}

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
