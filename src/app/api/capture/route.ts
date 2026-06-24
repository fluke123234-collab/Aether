/**
 * Aether · /api/capture — Google Gemini multimodal capture
 * ------------------------------------------------------------
 * Uses @google/generative-ai with gemini-2.0-flash.
 * No Z.ai SDK, no proxies, no internal endpoints.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { geminiVision, geminiAudio, geminiText, stripFences } from '@/lib/gemini-ai'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const VISION_PROMPT = `You are an infallible visual analysis core. Look at the raw pixels.
Read and extract ALL text (OCR), components, labels, specs, prices with absolute accuracy.
Your output MUST follow this exact layout:
[Line 1: A clean title in under 5 words]
[Line 2: Exactly 5 comma-separated tags like: tag1, tag2, tag3, tag4, tag5]
[Line 3+: A complete detailed breakdown of everything visible]
No JSON, no markdown. Just raw text in the exact layout above.`

const ENRICHMENT_PROMPT = `You are Aether's memory curator. Return JSON only.
Title max 5 words. Summary 1 sentence. 5 contextual tags.
Return: {"title":"...","summary":"...","tags":["t1","t2","t3","t4","t5"],"body":"corrected text"}`

const AUDIO_PROMPT = `Listen to this audio clip. Output exactly 3 lines:
[Line 1: A brief title summarizing the voice note in under 5 words]
[Line 2: Exactly 5 comma-separated indexing tags like: tag1, tag2, tag3, tag4, tag5]
[Line 3: The exact word-for-word text transcription of what was said]
No JSON, no markdown. Just raw text in the exact layout above.`

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

  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })

  const { data: authData } = await supabase.auth.getUser(token)
  if (!authData?.user) return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })

  const userId = authData.user.id
  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

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
    return NextResponse.json({ success: false, error: error?.message ?? 'insert_failed' }, { status: 500 })
  }

  const memoryId = data.id as string
  const base64Payload = hasImage && typeof body.image === 'string' ? body.image : ''

  // ════════════════════════════════════════════════════════════════
  // IMAGE PATH: Gemini Vision → 3-line split → DB update
  // ════════════════════════════════════════════════════════════════
  if (hasImage && base64Payload) {
    // Extract mime type from data URL
    const mimeMatch = base64Payload.match(/^data:(image\/[a-z]+);/)
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'

    const rawOutput = await geminiVision(VISION_PROMPT, base64Payload, mimeType, 7000)

    if (rawOutput) {
      const lines = rawOutput.split('\n').map(l => l.trim()).filter(Boolean)
      let title = 'Image capture'
      let tags: string[] = ['image', 'capture', 'visual']
      let description = rawOutput

      if (lines.length >= 3) {
        title = lines[0].slice(0, 80)
        const parsedTags = lines[1].toLowerCase().split(',').map(t => t.trim()).filter(Boolean).slice(0, 5)
        if (parsedTags.length >= 2) tags = ['image', ...parsedTags.filter(t => t !== 'image')].slice(0, 5)
        description = lines.slice(2).join('\n')
      } else if (lines.length === 1) {
        title = lines[0].slice(0, 80)
      }

      // Store description in body for search, but WITHOUT the [Image content:] wrapper
      // so it doesn't show on the card. The raw description IS the body.
      const enrichedBody = (content ? content + '\n\n' : '') + description.slice(0, 800)

      await userClient.from('memories').update({
        title, body: enrichedBody, content: enrichedBody,
        summary: description.slice(0, 280),
        tags, category: resolveCategory(tags, title, description), processing: false,
        metadata: { title, summary: description.slice(0, 280), tags, type: 'image',
          imageDescription: description, searchKeywords: tags, imageData: base64Payload },
      }).eq('id', memoryId)

      logger.info(`SUCCESS: Image memory ${memoryId} — title: "${title}"`)
      return NextResponse.json({ success: true, id: memoryId, enriched: true })
    }

    logger.warn('Aether · Gemini vision failed for capture, using fallback')
    await userClient.from('memories').update({
      title: content ? content.slice(0, 60) : 'Image capture',
      body: content || 'Image capture',
      summary: '', tags: ['image', 'capture'],
      category: resolveCategory(['image', 'capture'], 'Image capture', 'A captured image'), processing: false,
      metadata: { imageDescription: 'A captured image. Ask Aether to analyze it.', imageData: base64Payload },
    }).eq('id', memoryId)
    return NextResponse.json({ success: true, id: memoryId })
  }

  // ════════════════════════════════════════════════════════════════
  // AUDIO PATH: Gemini audio transcription → 3-line split → DB update
  // ════════════════════════════════════════════════════════════════
  if (hasAudio && typeof body.audio === 'string') {
    const audioPayload = body.audio
    const mimeMatch = audioPayload.match(/^data:(audio\/[a-z]+);/)
    const audioMimeType = mimeMatch ? mimeMatch[1] : 'audio/webm'

    const rawOutput = await geminiAudio(AUDIO_PROMPT, audioPayload, audioMimeType, 7000)

    if (rawOutput) {
      const lines = rawOutput.split('\n').map(l => l.trim()).filter(Boolean)
      let title = 'Voice note'
      let tags: string[] = ['voice', 'capture']
      let transcription = rawOutput

      if (lines.length >= 3) {
        title = lines[0].slice(0, 80)
        const parsedTags = lines[1].toLowerCase().split(',').map(t => t.trim()).filter(Boolean).slice(0, 5)
        if (parsedTags.length >= 2) tags = ['voice', ...parsedTags.filter(t => t !== 'voice')].slice(0, 5)
        transcription = lines.slice(2).join(' ')
      } else if (lines.length === 1) {
        title = lines[0].slice(0, 80)
      }

      const enrichedBody = (content ? content + '\n\n' : '') + transcription.slice(0, 800)

      await userClient.from('memories').update({
        title, body: enrichedBody, content: enrichedBody,
        summary: transcription.slice(0, 280),
        tags, category: 'others', processing: false,
        metadata: { title, summary: transcription.slice(0, 280), tags, type: 'voice',
          audioData: audioPayload, searchKeywords: tags },
      }).eq('id', memoryId)

      logger.info(`SUCCESS: Voice memory ${memoryId} — title: "${title}"`)
      return NextResponse.json({ success: true, id: memoryId, enriched: true })
    }

    // Gemini audio failed — fall back to text enrichment with user's text
    logger.warn('Aether · Gemini audio transcription failed, using text fallback')
    // Continue to text enrichment path below
  }

  // ════════════════════════════════════════════════════════════════
  // URL PATH: Web scrape → Gemini synthesis → 3-line split → DB update
  // ════════════════════════════════════════════════════════════════
  const isUrl = /^https?:\/\/[^\s]+/i.test(content)
  if (isUrl) {
    const incomingUrl = content.match(/^(https?:\/\/[^\s]+)/i)?.[1] || content
    let scrapedContent = ''

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const webResponse = await fetch(incomingUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (webResponse.ok) {
        const htmlText = await webResponse.text()
        scrapedContent = htmlText
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000)

        // Fallback: if scraped content is too short, try og:description / twitter:description
        if (scrapedContent.length < 100) {
          const ogMatch = htmlText.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i)
          const twMatch = htmlText.match(/<meta\s+(?:property|name)=["']twitter:description["']\s+content=["']([^"']+)["']/i)
          const descMatch = htmlText.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)
          scrapedContent = (ogMatch?.[1] || twMatch?.[1] || descMatch?.[1] || scrapedContent).slice(0, 6000)
        }
      }
    } catch (err) {
      logger.warn('Aether · URL scrape failed:', err instanceof Error ? err.message.slice(0, 80) : err)
    }

    if (scrapedContent) {
      const URL_PROMPT = `Analyze this scraped webpage content text. Output exactly 3 lines:
[Line 1: A clean, context-focused title for the memory under 5 words summarizing the page]
[Line 2: Exactly 5 comma-separated indexing tags like: tag1, tag2, tag3, tag4, tag5]
[Line 3+: A concise but highly detailed architectural summary of the core knowledge on this page]
No JSON, no markdown. Just raw text in the exact layout above.

Content:
${scrapedContent}`

      const rawOutput = await geminiText(URL_PROMPT, undefined, 8000)

      if (rawOutput) {
        const lines = rawOutput.split('\n').map(l => l.trim()).filter(Boolean)
        let title = 'Web link'
        let tags: string[] = ['link', 'capture']
        let summary = rawOutput

        if (lines.length >= 3) {
          title = lines[0].slice(0, 80)
          const parsedTags = lines[1].toLowerCase().split(',').map(t => t.trim()).filter(Boolean).slice(0, 5)
          if (parsedTags.length >= 2) tags = ['link', ...parsedTags.filter(t => t !== 'link')].slice(0, 5)
          summary = lines.slice(2).join(' ')
        } else if (lines.length === 1) {
          title = lines[0].slice(0, 80)
        }

        const enrichedBody = summary.slice(0, 1000)

        await userClient.from('memories').update({
          title, body: enrichedBody, content: enrichedBody,
          summary: summary.slice(0, 280),
          tags, category: 'others', processing: false,
          metadata: { title, summary: summary.slice(0, 280), tags, type: 'link',
            sourceUrl: incomingUrl, originalScrape: scrapedContent.slice(0, 4000), searchKeywords: tags },
        }).eq('id', memoryId)

        logger.info(`SUCCESS: URL memory ${memoryId} — title: "${title}"`)
        return NextResponse.json({ success: true, id: memoryId, enriched: true })
      }

      // Gemini failed — store URL with basic info
      logger.warn('Aether · URL synthesis failed, storing basic link')
      await userClient.from('memories').update({
        title: incomingUrl.slice(0, 60),
        body: scrapedContent.slice(0, 500),
        summary: '', tags: ['link', 'capture'],
        category: 'others', processing: false,
        metadata: { sourceUrl: incomingUrl, originalScrape: scrapedContent.slice(0, 4000) },
      }).eq('id', memoryId)
      return NextResponse.json({ success: true, id: memoryId })
    }

    // Scrape failed — store as plain text link
    logger.warn('Aether · URL scrape failed, storing as plain text')
    await userClient.from('memories').update({
      title: incomingUrl.slice(0, 60),
      body: incomingUrl,
      summary: '', tags: ['link', 'capture'],
      category: 'others', processing: false,
      metadata: { sourceUrl: incomingUrl },
    }).eq('id', memoryId)
    return NextResponse.json({ success: true, id: memoryId })
  }

  // ════════════════════════════════════════════════════════════════
  // TEXT PATH: Gemini text enrichment
  // ════════════════════════════════════════════════════════════════
  const textForEnrichment = content || (hasAudio ? 'Voice note' : '')
  let aiResponseString: string | null = null

  if (textForEnrichment.length >= 20) {
    aiResponseString = await geminiText(
      textForEnrichment.slice(0, 500),
      ENRICHMENT_PROMPT,
      6000
    )
  }

  try {
    let aiData: { title?: unknown; summary?: unknown; tags?: unknown; body?: unknown }
    if (aiResponseString) {
      aiData = JSON.parse(stripFences(aiResponseString))
    } else {
      aiData = { title: textForEnrichment.slice(0, 60), summary: '', tags: ['capture'] }
    }

    const title = typeof aiData.title === 'string' && aiData.title.trim() ? aiData.title.trim().slice(0, 80) : 'Untitled Thought'
    const summary = typeof aiData.summary === 'string' ? aiData.summary.trim().slice(0, 280) : ''
    let tags: string[] = Array.isArray(aiData.tags) ? aiData.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(t => t.trim()).slice(0, 5) : []
    if (tags.length === 0) tags = hasAudio ? ['voice', 'capture'] : ['capture', 'note']
    const correctedBody = typeof aiData.body === 'string' && aiData.body.trim() ? aiData.body.trim().slice(0, 500) : finalContent
    // Single-category: use resolveCategory to force into 6 buckets
    const memoryType = hasAudio ? 'others' : resolveCategory(tags, title, correctedBody)

    const metadataObj: Record<string, unknown> = { title, summary, tags, type: memoryType, searchKeywords: tags }
    if (hasAudio && typeof body.audio === 'string') metadataObj.audioData = body.audio

    await userClient.from('memories').update({
      metadata: metadataObj, title, body: correctedBody, content: correctedBody,
      summary, tags, category: memoryType, processing: false,
    }).eq('id', memoryId)

    return NextResponse.json({ success: true, id: memoryId, enriched: true })
  } catch (parseError) {
    logger.error('Enrichment parse failed:', parseError instanceof Error ? parseError.message : parseError)
    const fallbackTags = hasAudio ? ['voice', 'capture'] : ['capture', 'note']
    await userClient.from('memories').update({
      processing: false, tags: fallbackTags, title: finalContent.slice(0, 60) || 'Untitled Thought', category: 'others',
    }).eq('id', memoryId)
    return NextResponse.json({ success: true, id: memoryId })
  }
}

function classifyMemoryType(text: string): string {
  const t = text.toLowerCase()
  if (/\b(work|job|career|office|meeting|project|deadline|client|boss|colleague|email|report|presentation|startup|company|business|code|coding|program)\b/.test(t)) return 'work'
  if (/\b(recipe|cooking|restaurant|food|eat|meal|dinner|lunch|breakfast|cafe|bake|chef|cuisine)\b/.test(t)) return 'food'
  if (/\b(read|novel|article|book|chapter|author|publish|literature|textbook|study|learn)\b/.test(t)) return 'books'
  if (/\b(movie|game|music|show|series|anime|concert|podcast|stream|video|youtube|netflix|spotify)\b/.test(t)) return 'entertainment'
  if (/\b(idea|concept|imagine|brainstorm|could be|might be|product|app|feature|design|build|create|invent|future|startup|vision)\b/.test(t)) return 'ideas'
  return 'others'
}

/** Strict 6-category mapper — forces any tag/text into one of the 6 buckets */
function resolveCategory(tags: string[], title: string, body: string): string {
  const allowed = ['work', 'books', 'ideas', 'food', 'entertainment', 'others']
  const primaryTag = tags[0]?.toLowerCase().trim()
  if (primaryTag && allowed.includes(primaryTag)) return primaryTag

  // Keyword fallback
  const text = (title + ' ' + body).toLowerCase()
  if (/\b(recipe|cooking|restaurant|food|eat|meal|dinner|lunch|breakfast|cafe|bake)\b/.test(text)) return 'food'
  if (/\b(code|project|meeting|work|job|office|business|deadline|client|report)\b/.test(text)) return 'work'
  if (/\b(read|novel|article|book|chapter|author|study|learn|textbook)\b/.test(text)) return 'books'
  if (/\b(movie|game|music|show|series|anime|concert|podcast|stream|video)\b/.test(text)) return 'entertainment'
  if (/\b(concept|startup|future|idea|imagine|brainstorm|vision|invent)\b/.test(text)) return 'ideas'
  return 'others'
}
