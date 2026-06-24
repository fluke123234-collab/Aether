/**
 * Aether · /api/ask — Google Gemini text + vision (Vercel 10s optimized)
 * ------------------------------------------------------------
 * Uses @google/generative-ai with gemini-2.0-flash.
 * No Z.ai SDK, no proxies, no internal endpoints.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { geminiVision, geminiText, stripFences } from '@/lib/gemini-ai'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

type MemoryRef = { id: string; title: string; body: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

const SYSTEM_PROMPT = `You are Aether—a refined digital sanctuary. Speak with clean authority. No fillers. Never mention a database. Respond with JSON only: {"answer":"...","memoryIds":["id1"]}`

const VISION_PROMPT = `You are Aether. Read the image pixels. Extract all text, labels, specs exactly. Respond with JSON only: {"answer":"...","memoryIds":["id1"]}`

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

  // ════════════════════════════════════════════════════════════════
  // ROUTE 1: VISION — Gemini gemini-2.0-flash (supports vision)
  // ════════════════════════════════════════════════════════════════
  if (visionImage) {
    const mimeMatch = visionImage.match(/^data:(image\/[a-z]+);/)
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'

    const prompt = `${VISION_PROMPT}\n\nQuestion: ${question || 'What is in this image?'}\n\nRespond with JSON:\n{"answer":"...","memoryIds":["${imageMemoryId || ''}"]}`

    // 8s timeout for vision — gives the proxy enough time
    const raw = await geminiVision(prompt, visionImage, mimeType, 8000)

    if (raw) {
      const parsed = parseAnswer(raw, memories)
      if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) parsed.memoryIds.unshift(imageMemoryId)
      return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
    }

    // VLM failed — try text AI with the cached description from metadata
    logger.warn('Aether · Gemini vision failed, trying text AI with cached description')
    const imgMem = memories.find(m => m.id === imageMemoryId)
    // Use the full body text as the cached description (no more [Image content:] wrapper)
    const cached = imgMem?.body || ''
    const isFallback = cached.includes('A captured image. Ask Aether to analyze') || cached.trim() === '' || cached === 'Image capture'

    if (cached && !isFallback) {
      // Use text AI to answer the question from the cached description
      const textPrompt = `Based on this cached image description, answer the user's question. Respond with JSON only: {"answer":"...","memoryIds":["${imageMemoryId || ''}"]}\n\nCached description: ${cached}\n\nQuestion: ${question}`
      const textResult = await geminiText(textPrompt, SYSTEM_PROMPT, 6000)
      if (textResult) {
        const parsed = parseAnswer(textResult, memories)
        if (imageMemoryId && !parsed.memoryIds.includes(imageMemoryId)) parsed.memoryIds.unshift(imageMemoryId)
        return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
      }
      // Text AI also failed — return the raw cached description
      return NextResponse.json({
        success: true,
        answer: `Based on what I captured: ${cached.slice(0, 500)}`,
        memoryIds: imageMemoryId ? [imageMemoryId] : []
      } satisfies AskResponse)
    }

    // No cached description or it's the fallback text
    return NextResponse.json({
      success: true,
      answer: "I can see your image but couldn't analyze it. The image may have been captured before the analysis engine was available. Try deleting and re-capturing it.",
      memoryIds: imageMemoryId ? [imageMemoryId] : []
    } satisfies AskResponse)
  }

  // ════════════════════════════════════════════════════════════════
  // ROUTE 2: TEXT-ONLY — Gemini text (6s timeout)
  // ════════════════════════════════════════════════════════════════
  const context = memories.length > 0
    ? `MEMORIES:\n${memories.map(m => `id=${m.id} | ${m.title}: ${m.body.slice(0, 150)}`).join('\n')}\n\n`
    : ''

  const fullPrompt = `${context}Question: ${question}\n\nRespond with JSON only: {"answer":"...","memoryIds":["id1"]}`

  const raw = await geminiText(fullPrompt, SYSTEM_PROMPT, 6000)
  if (raw) {
    const parsed = parseAnswer(raw, memories)
    return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
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
