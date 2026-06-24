/**
 * Aether · /api/ask — Direct fetch AI (Vercel 10s optimized)
 * ------------------------------------------------------------
 * Vercel Hobby = 10s HARD limit. maxDuration=60 is ignored on Hobby.
 * 
 * Flow:
 * 1. Auth + DB query (10 memories, no metadata): ~700ms
 * 2. If image memory exists: VLM (6s) → cached desc fallback (0s)
 * 3. If no image: text AI (6s) — uses trimmed context for speed
 * 
 * Total: ~7s max — fits within 10s.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const ZAI_BASE_URL = 'https://internal-api.z.ai/v1'
const ZAI_API_KEY = 'Z.ai'
const ZAI_CHAT_ID = 'chat-29bf48db-839a-48ab-a402-026a1fd7cc19'
const ZAI_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMmZkYWFkZmItZjAwMC00ODY3LWJiMDktZGM5Yjg1YTY5NzVlIiwiY2hhdF9pZCI6ImNoYXQtMjliZjQ0ZGItODM5YS00OGFiLWE0MDItMDI2YTFmZDdjYzE5IiwicGxhdGZvcm0iOiJ6YWkifQ.fMoxcqePFaXXPFrxh1ikzPOFYaFpyytyjc1QM8Nckf8'
const ZAI_USER_ID = '2fdaadfb-f000-4867-bb09-dc9b85a6975e'

function zaiHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ZAI_API_KEY}`,
    'X-Z-AI-From': 'Z',
    'X-Chat-Id': ZAI_CHAT_ID,
    'X-User-Id': ZAI_USER_ID,
    'X-Token': ZAI_TOKEN,
  }
}

/** Direct fetch to ZAI text API with hard timeout */
async function zaiText(messages: Array<{ role: string; content: string }>, timeoutMs = 6000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
      method: 'POST', headers: zaiHeaders(), signal: controller.signal,
      body: JSON.stringify({ messages, thinking: { type: 'disabled' } }),
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : null
  } catch { return null }
}

/** Direct fetch to ZAI vision API with hard timeout */
async function zaiVision(prompt: string, imageDataUrl: string, timeoutMs = 6000): Promise<string> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(`${ZAI_BASE_URL}/chat/completions/vision`, {
      method: 'POST', headers: zaiHeaders(), signal: controller.signal,
      body: JSON.stringify({
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ]}],
        thinking: { type: 'disabled' },
      }),
    })
    clearTimeout(timeout)
    if (!res.ok) return ''
    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content
    return typeof content === 'string' && content.trim() ? content.trim() : ''
  } catch { return '' }
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

  // ── Load 8 memories WITHOUT metadata (fast) ──
  const { data: rows } = await userClient
    .from('memories').select('id, title, body, created_at')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(8)

  const memories: MemoryRef[] = (rows ?? []).map((r) => ({
    id: r.id, title: r.title || 'Untitled', body: (r.body || '').slice(0, 300)
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

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION (6s timeout, return immediately on failure)
  // ════════════════════════════════════════════════════════════════
  if (visionImage) {
    const prompt = `You are Aether. Read the image pixels. Extract all text, labels, specs exactly. Respond with JSON only:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}\n\nQuestion: ${question || 'What is in this image?'}`

    const raw = await zaiVision(prompt, visionImage, 6000)
    if (raw) {
      const parsed = parseAnswer(raw, memories)
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) parsed.memoryIds.unshift(imageMemoryId)
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
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
  // ROUTE 2: TEXT-ONLY (6s timeout — leaves 3s buffer for DB/auth)
  // ════════════════════════════════════════════════════════════════
  const context = memories.length > 0
    ? `MEMORIES:\n${memories.map(m => `id=${m.id} | ${m.title}: ${m.body.slice(0, 150)}`).join('\n')}\n\n`
    : ''

  const messages = [
    { role: 'system', content: 'You are Aether—a refined digital sanctuary. Speak with clean authority. No fillers. Never mention a database. Respond with JSON only: {"answer":"...","memoryIds":["id1"]}' },
    ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })),
    { role: 'user', content: context + question }
  ]

  const raw = await zaiText(messages, 6000)
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
