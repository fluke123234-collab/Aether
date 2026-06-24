/**
 * Aether · /api/ask — Uses ZAI.create() + .z-ai-config (works on Vercel)
 * ------------------------------------------------------------
 * The .z-ai-config file is deployed to Vercel and has the correct token.
 * ZAI.create() reads it via loadConfig() from process.cwd()/.z-ai-config.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ── ZAI singleton — created once via ZAI.create() ──
let zaiInstance: any = null
async function getZai() {
  if (zaiInstance) return zaiInstance
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    zaiInstance = await ZAIModule.default.create()
    return zaiInstance
  } catch (err) {
    logger.error('Aether · ZAI.create() failed:', err instanceof Error ? err.message : err)
    return null
  }
}

function stripFences(raw: string): string {
  let c = raw.trim()
  if (c.startsWith('```')) c = c.replace(/^```(?:json|text|html)?\s*/i, '').replace(/\s*```$/, '')
  return c
}

type MemoryRef = { id: string; title: string; body: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  const { data: authData } = await supabase.auth.getUser(token)
  if (!authData?.user) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  let body: { question?: unknown; history?: unknown; image?: unknown; memoryImage?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'invalid_json' } satisfies AskResponse, { status: 400 }) }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const userImage = typeof body.image === 'string' && body.image.startsWith('data:image/') ? body.image : ''
  const memImage = typeof body.memoryImage === 'string' && body.memoryImage.startsWith('data:image/') ? body.memoryImage : ''
  if (!question && !userImage && !memImage) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'empty_question' } satisfies AskResponse, { status: 400 })

  const rawHistory = Array.isArray(body.history) ? body.history : []
  const history = rawHistory.filter((h): h is { role: 'user' | 'model'; text: string } => typeof h === 'object' && h !== null && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string').slice(-4)

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  // ── POOL-SAFE: Load 5 most recent memories, lean fields only ──
  const { data: rows } = await userClient
    .from('memories').select('id, title, body, tags, category, created_at')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(5)

  const memories: MemoryRef[] = (rows ?? []).map((r) => ({
    id: r.id, title: r.title || 'Untitled', body: (r.body || '').slice(0, 200)
  }))

  // ── Check for image memory ──
  let visionImage = userImage || memImage
  let imageMemoryId: string | undefined

  if (!visionImage) {
    const { data: imageRow } = await userClient
      .from('memories').select('id, metadata')
      .eq('user_id', authData.user.id).eq('category', 'image')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    if (imageRow) {
      const meta = imageRow.metadata as { imageData?: string } | null
      if (meta?.imageData?.startsWith('data:image/')) {
        visionImage = meta.imageData
        imageMemoryId = imageRow.id
        if (!memories.find(m => m.id === imageRow.id)) {
          memories.unshift({ id: imageRow.id, title: 'Image memory', body: '' })
        }
      }
    }
  } else {
    imageMemoryId = memories.find(m => m.body?.includes('[Image content:'))?.id
  }

  const zai = await getZai()

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION
  // ════════════════════════════════════════════════════════════════
  if (visionImage && zai) {
    try {
      const prompt = `You are Aether. Read the image pixels. Extract all text, labels, specs exactly. Respond with JSON only:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}\n\nQuestion: ${question || 'What is in this image?'}`

      const visionPromise = zai.chat.completions.createVision({
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: visionImage } },
        ]}],
        thinking: { type: 'disabled' },
      })

      const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 6000))
      const res = await Promise.race([visionPromise, timeoutPromise])

      if (res) {
        const raw = res.choices?.[0]?.message?.content ?? ''
        if (raw.trim()) {
          const parsed = parseAnswer(raw, memories)
          if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) parsed.memoryIds.unshift(imageMemoryId)
          return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
        }
      }
    } catch (err) {
      logger.warn('Aether · vision failed:', err instanceof Error ? err.message : err)
    }

    // VLM failed — return cached description immediately
    const imgMem = memories.find(m => m.id === imageMemoryId)
    const cached = imgMem?.body?.match(/\[Image content: ([\s\S]+)\]/)?.[1] || ''
    const isFallback = cached.includes('A captured image. Ask Aether to analyze')

    return NextResponse.json({
      success: true,
      answer: cached && !isFallback
        ? `Based on what I captured: ${cached.slice(0, 400)}`
        : "I can see your image but couldn't analyze it right now. Please try again.",
      memoryIds: imageMemoryId ? [imageMemoryId] : []
    } satisfies AskResponse)
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY
  // ════════════════════════════════════════════════════════════════
  if (!zai) {
    return NextResponse.json({
      success: true,
      answer: "My connection to your sanctuary is processing slowly right now. Let's try that thought again in a moment.",
      memoryIds: []
    } satisfies AskResponse)
  }

  const context = memories.length > 0
    ? `MEMORIES:\n${memories.map(m => `id=${m.id} | ${m.title}: ${m.body.slice(0, 150)}`).join('\n')}\n\n`
    : ''

  const messages = [
    { role: 'system', content: 'You are Aether—a refined digital sanctuary. Speak with clean authority. No fillers. Never mention a database. Respond with JSON only: {"answer":"...","memoryIds":["id1"]}' },
    ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
    { role: 'user', content: context + question }
  ]

  try {
    const chatPromise = zai.chat.completions.create({ messages })
    const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 6000))
    const res = await Promise.race([chatPromise, timeoutPromise])

    if (res) {
      const raw = res.choices?.[0]?.message?.content ?? ''
      if (raw.trim()) {
        const parsed = parseAnswer(raw, memories)
        return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
      }
    }
  } catch (err) {
    logger.warn('Aether · text failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({
    success: true,
    answer: "My connection to your sanctuary is processing slowly right now. Let's try that thought again in a moment.",
    memoryIds: []
  } satisfies AskResponse)
}

function parseAnswer(raw: string, memories: MemoryRef[]): { answer: string; memoryIds: string[] } {
  const cleaned = stripFences(raw)
  try {
    const p = JSON.parse(cleaned)
    if (typeof p.answer === 'string' && p.answer.trim()) {
      const validIds = new Set(memories.map(m => m.id))
      const ids = Array.isArray(p.memoryIds) ? p.memoryIds.map((id: unknown) => typeof id === 'number' ? String(id) : id).filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id as string)).slice(0, 5) : []
      return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids }
    }
  } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      const p = JSON.parse(match[0])
      if (typeof p.answer === 'string' && p.answer.trim()) {
        const validIds = new Set(memories.map(m => m.id))
        const ids = Array.isArray(p.memoryIds) ? p.memoryIds.map((id: unknown) => typeof id === 'number' ? String(id) : id).filter((id: unknown): id is string => typeof id === 'string' && validIds.has(id as string)).slice(0, 5) : []
        return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids }
      }
    } catch {}
  }
  return { answer: cleaned.trim().slice(0, 2000), memoryIds: [] }
}
