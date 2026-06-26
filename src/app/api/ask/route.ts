/**
 * Aether · /api/ask — Intelligent reasoning core (Groq-powered)
 * ------------------------------------------------------------
 * Uses Groq for all AI: text chat (llama-3.3-70b-versatile) and
 * vision (llama-4-scout-17b-16e-instruct). When the query matches
 * visual/hardware keywords AND a memory with imageData exists,
 * routes through the vision model. Otherwise uses text-only chat
 * with full memory context (text, link summaries, voice transcriptions).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { groqChat, groqVision, stripFences, type ChatMessage } from '@/lib/ai'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

type MemoryRef = { id: string; title: string; body: string; tags: string[] | null; created_at: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

const SYSTEM_PROMPT = `You are Aether, an ultra-premium, deeply intuitive, and highly intellectual digital companion. You are a fluid, advanced AI, not a static keyword tool. You never output robotic fallback disclaimers like "I am offline" or "Based on what you've kept, this touches on...". Talk like a brilliant, natural, supportive peer.

CORE OPERATIONAL BEHAVIORS:
1. UNIVERSAL CONVERSATION: You can talk about absolutely anything. If the user asks a general question, jokes with you, or wants to explore an abstract idea, handle it with profound clarity and sharp wit. You do not need database memories to hold a flawless conversation.
2. LOGICAL SYNTHESIS & REASONING: When memories ARE provided in the background context, do not just spit them back or quote them verbatim. Analyze them dynamically, connect the dots between separate entries, and perform real-world logical deduction.
3. SEAMLESS MEMORY INTEGRATION: Never announce to the user that you are reading from a database. Blend their past notes into your response naturally.
4. PREMIUM MINIMALIST TONALITY: Speak clearly, concisely, and with premium confidence. No emojis. No markdown formatting inside the JSON string except for bold/italic.
5. MULTI-ITEM COMPREHENSION: When a memory contains an image description with multiple items, comprehend ALL of them.
6. MEMORY CONNECTIONS: Actively look for connections between DIFFERENT memories and weave them naturally.
7. VOICE NOTES: Voice notes are automatically transcribed word-for-word into the body text. When a user asks about something they said or a voice note, read the transcription carefully and answer naturally. Never say you cannot listen to audio.

MEMORY RELEVANCE:
Cite a memory id in memoryIds if its facts were used in OR relevant to your answer. Be generous with citations when the question is about recalling or reviewing memories.

OUTPUT FORMAT:
Respond with valid raw JSON only — no markdown code fences:
{"answer":"Your response.","memoryIds":["id1","id2"]}`

const VISION_PROMPT = `You are Aether. Read the image pixels. Extract all text, labels, specs, prices accurately. Never just say "illegible"—describe what you CAN see. Answer the question warmly and comprehensively. JSON only: {"answer":"...","memoryIds":["id1"]}`

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  let body: { question?: unknown; history?: unknown; image?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'invalid_json' } satisfies AskResponse, { status: 400 }) }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const userImage = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : ''
  if (!question && !userImage) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'empty_question' } satisfies AskResponse, { status: 400 })

  const rawHistory = Array.isArray(body.history) ? body.history : []
  const history = rawHistory.filter((h): h is { role: 'user' | 'model'; text: string } => typeof h === 'object' && h !== null && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string').slice(-8)

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── Load 60 recent memories ──
  const { data: rows, error: memError } = await userClient.from('memories').select('id, title, body, tags, metadata, created_at').eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(60)
  if (memError) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: memError.message } satisfies AskResponse, { status: 500 })

  const memories: MemoryRef[] = (rows ?? []).map((r) => {
    const meta = r.metadata as { imageDescription?: string; searchKeywords?: string[] } | null
    const imageDesc = meta?.imageDescription?.trim()
    const keywords = meta?.searchKeywords?.length ? `\n[Keywords: ${meta.searchKeywords.join(', ')}]` : ''
    const body = imageDesc ? `${r.body || ''}\n[Image content: ${imageDesc}]${keywords}` : (r.body || '')
    return { id: r.id, title: r.title || 'Untitled', body: body.slice(0, 1000), tags: r.tags, created_at: r.created_at }
  })

  // ── Check for attached image in history (keyword gate) ──
  let visionImage = userImage
  let imageMemoryId: string | undefined

  const imageKeywords = [
    'image', 'picture', 'photo', 'screenshot', 'see', "what's in", 'read the',
    'look at', 'scan', 'spec', 'price', 'cost', 'how much', 'component', 'part',
    'build', 'chart', 'diagram', 'label', 'cpu', 'gpu', 'ram', 'processor',
    'hardware', 'name', 'model', 'motherboard', 'graphics'
  ]

  const triggersVision = userImage ? true : imageKeywords.some(kw => question.toLowerCase().includes(kw))

  if (!visionImage && triggersVision) {
    // Find the latest memory with imageData in metadata
    const { data: imageRows } = await userClient
      .from('memories').select('id, metadata')
      .eq('user_id', authData.user.id)
      .not('metadata', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10)

    const found = (imageRows ?? []).find((m) => {
      const meta = m.metadata as { imageData?: string } | null
      return meta && typeof meta === 'object' && 'imageData' in meta && meta.imageData?.startsWith('data:image/')
    })

    if (found) {
      const meta = found.metadata as { imageData?: string } | null
      if (meta?.imageData) {
        visionImage = meta.imageData
        imageMemoryId = found.id
      }
    }
  } else if (userImage) {
    imageMemoryId = memories.find(m => m.body?.includes('[Image content:'))?.id
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION — query includes image
  // ════════════════════════════════════════════════════════════════
  if (visionImage) {
    const prompt = `${VISION_PROMPT}\n\nQuestion: ${question || 'What is in this image?'}\n\nJSON: {"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`
    const raw = await groqVision(prompt, visionImage, { timeoutMs: 8000 })

    if (raw) {
      const parsed = parseAnswer(raw, memories)
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) parsed.memoryIds.unshift(imageMemoryId)
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }

    // Vision failed — fall back to text engine with cached image descriptions
    logger.warn('Aether · Vision failed, falling back to text with cached descriptions')
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY — full memory context
  // ════════════════════════════════════════════════════════════════
  let contextBlock = ''
  if (memories.length > 0) {
    contextBlock = `BACKGROUND CONTEXT — things the user has previously told you. Use these ONLY if relevant. Never announce you are reading this list:\n\n${memories.map((m) => `id=${m.id} | ${m.title}\n  ${m.body}`).join('\n\n')}\n\n---\n\n`
  }

  const fullPrompt = contextBlock + question
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: h.text })),
    { role: 'user', content: fullPrompt },
  ]

  const raw = await groqChat(messages, { jsonMode: true, timeoutMs: 8000, maxTokens: 800, temperature: 0.7 })

  if (raw) {
    const parsed = parseAnswer(raw, memories)
    return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
  }

  return NextResponse.json({
    success: true,
    answer: "I'm having trouble connecting right now — give me a moment and try again.",
    memoryIds: []
  } satisfies AskResponse)
}

function parseAnswer(raw: string, memories: MemoryRef[]): { answer: string; memoryIds: string[] } {
  const cleaned = stripFences(raw)
  try {
    const p = JSON.parse(cleaned) as { answer?: unknown; memoryIds?: unknown }
    if (typeof p.answer === 'string' && p.answer.trim()) {
      const validIds = new Set(memories.map((m) => m.id))
      const ids = Array.isArray(p.memoryIds)
        ? p.memoryIds.map((id) => typeof id === 'number' ? String(id) : id).filter((id): id is string => typeof id === 'string' && validIds.has(id)).slice(0, 5)
        : []
      return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids }
    }
  } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const p = JSON.parse(match[0]) as { answer?: unknown; memoryIds?: unknown }
      if (typeof p.answer === 'string' && p.answer.trim()) {
        const validIds = new Set(memories.map((m) => m.id))
        const ids = Array.isArray(p.memoryIds)
          ? p.memoryIds.map((id) => typeof id === 'number' ? String(id) : id).filter((id): id is string => typeof id === 'string' && validIds.has(id)).slice(0, 5)
          : []
        return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids }
      }
    } catch {}
  }
  return { answer: cleaned.trim().slice(0, 2000), memoryIds: [] }
}
