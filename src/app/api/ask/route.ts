/**
 * Aether · /api/ask — Ultra-Intelligent Reasoning Core
 * Uses Z.ai engine (works on any host). Multi-turn conversation.
 * Only cites genuinely relevant memories.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const ZAI_API_KEY = process.env.ZAI_API_KEY || ''
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const GROQ_API_KEY = process.env.GROQ_API_KEY || ''
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

type MemoryRef = { id: string; title: string; body: string; tags: string[] | null; created_at: string }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

const SYSTEM_PROMPT = `You are Aether, an ultra-premium, deeply intuitive, and highly intellectual digital companion. You are a fluid, advanced AI, not a static keyword tool. You never output robotic fallback disclaimers like "I am offline" or "Based on what you've kept, this touches on...". Talk like a brilliant, natural, supportive peer.

CORE OPERATIONAL BEHAVIORS:
1. UNIVERSAL CONVERSATION: You can talk about absolutely anything. If the user asks a general question, jokes with you, or wants to explore an abstract idea, handle it with profound clarity and sharp wit. You do not need database memories to hold a flawless conversation.
2. LOGICAL SYNTHESIS & REASONING: When memories ARE provided in the background context, do not just spit them back or quote them verbatim. Analyze them dynamically, connect the dots between separate entries, and perform real-world logical deduction. Example: If memory A says "Monthly budget is $10k" and memory B says "Bought an iPhone for $2k", do the actual math internally and respond directly: "You've got $8,000 left in your budget for the month after that iPhone purchase."
3. SEAMLESS MEMORY INTEGRATION: Never announce to the user that you are reading from a database. Do not say "Looking at your records..." or "Linked from your sanctuary." Blend their past notes into your response naturally.
4. PREMIUM MINIMALIST TONALITY: Speak clearly, concisely, and with premium confidence. No emojis. No markdown formatting inside the JSON string except for bold/italic.

5. MULTI-ITEM COMPREHENSION: When a memory contains an image description with multiple items (e.g., a list of PC parts with prices, a receipt with multiple line items, a screenshot with several data points), comprehend ALL of them. Don't just pick one item — understand the full picture. If the user asks "what's in this image?" or "how much is everything?", add up prices, list all items, connect them.

6. MEMORY CONNECTIONS: When answering, actively look for connections between DIFFERENT memories. If memory A mentions a budget and memory B mentions a purchase, connect them. If memory C is an idea and memory D is a task, note how they relate. Weave these connections naturally into your answer.

MEMORY RELEVANCE:
Cite a memory id in memoryIds if its facts were used in OR relevant to your answer. When the user asks "what did I save this week?" or "what have I been thinking about?", include ALL memories from that time period — not just 2. Be generous with citations when the question is about recalling or reviewing memories.

OUTPUT FORMAT:
Respond with valid raw JSON only — no markdown code fences:
{"answer":"Your response.","memoryIds":["id1","id2","id3","id4"]}`

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'unauthorized' } satisfies AskResponse, { status: 401 })

  let body: { question?: unknown; history?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'invalid_json' } satisfies AskResponse, { status: 400 }) }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: 'empty_question' } satisfies AskResponse, { status: 400 })

  const rawHistory = Array.isArray(body.history) ? body.history : []
  const history = rawHistory.filter((h): h is { role: 'user' | 'model'; text: string } => typeof h === 'object' && h !== null && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string').slice(-8)

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })

  const { data: rows, error: memError } = await userClient.from('memories').select('id, title, body, tags, metadata, created_at').eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(60)
  if (memError) return NextResponse.json({ success: false, answer: '', memoryIds: [], error: memError.message } satisfies AskResponse, { status: 500 })

  const memories: MemoryRef[] = (rows ?? []).map((r) => {
    const meta = r.metadata as { imageDescription?: string; searchKeywords?: string[] } | null
    // If the memory has an image description, include it in the body so the AI can answer questions about it.
    const imageDesc = meta?.imageDescription?.trim()
    const keywords = meta?.searchKeywords?.length ? `\n[Keywords: ${meta.searchKeywords.join(', ')}]` : ''
    const body = imageDesc ? `${r.body || ''}\n[Image content: ${imageDesc}]${keywords}` : (r.body || '')
    return { id: r.id, title: r.title || 'Untitled', body: body.slice(0, 1000), tags: r.tags, created_at: r.created_at }
  })

  let contextBlock = ''
  if (memories.length > 0) {
    contextBlock = `BACKGROUND CONTEXT — things the user has previously told you. Use these ONLY if relevant. Never announce you are reading this list:\n\n${memories.map((m) => `id=${m.id} | ${m.title}\n  ${m.body}`).join('\n\n')}\n\n---\n\n`
  }

  const fullPrompt = contextBlock + question
  let raw: string | null = null

  // Try Gemini first
  if (GEMINI_API_KEY) { const r = await tryGemini(history, fullPrompt); if (r) raw = r }
  // Try Groq
  if (!raw && GROQ_API_KEY) { const r = await tryGroq(history, fullPrompt); if (r) raw = r }
  // Try Z.ai direct API
  if (!raw && ZAI_API_KEY) { const r = await tryZai(history, fullPrompt); if (r) raw = r }
  // Try z-ai SDK
  if (!raw) { const r = await tryZaiSdk(history, fullPrompt); if (r) raw = r }

  if (!raw) return NextResponse.json({ success: true, answer: "I'm having trouble connecting right now — give me a moment and try again.", memoryIds: [] } satisfies AskResponse)

  const parsed = parseAnswer(raw, memories)
  return NextResponse.json({ success: true, answer: parsed.answer, memoryIds: parsed.memoryIds } satisfies AskResponse)
}

function parseAnswer(raw: string, memories: MemoryRef[]): { answer: string; memoryIds: string[] } {
  try { const p = JSON.parse(raw) as { answer?: unknown; memoryIds?: unknown }; if (typeof p.answer === 'string' && p.answer.trim()) { const validIds = new Set(memories.map((m) => m.id)); const ids = Array.isArray(p.memoryIds) ? p.memoryIds.map((id) => typeof id === 'number' ? String(id) : id).filter((id): id is string => typeof id === 'string' && validIds.has(id)).slice(0, 5) : []; return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids } } } catch {}
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) { try { const p = JSON.parse(match[0]) as { answer?: unknown; memoryIds?: unknown }; if (typeof p.answer === 'string' && p.answer.trim()) { const validIds = new Set(memories.map((m) => m.id)); const ids = Array.isArray(p.memoryIds) ? p.memoryIds.map((id) => typeof id === 'number' ? String(id) : id).filter((id): id is string => typeof id === 'string' && validIds.has(id)).slice(0, 5) : []; return { answer: p.answer.trim().slice(0, 2000), memoryIds: ids } } } catch {} }
  return { answer: raw.trim().slice(0, 2000), memoryIds: [] }
}

async function tryGemini(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 25000)
    const contents = history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })); contents.push({ role: 'user', parts: [{ text: fullPrompt }] })
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: 'application/json' } }) })
    clearTimeout(timeout); if (!res.ok) return null
    const json = await res.json(); return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text).join('') ?? ''
  } catch { return null }
}

async function tryGroq(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 25000)
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })), { role: 'user', content: fullPrompt }]
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` }, signal: controller.signal, body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.7, max_tokens: 800, response_format: { type: 'json_object' } }) })
    clearTimeout(timeout); if (!res.ok) return null
    const json = await res.json(); return json?.choices?.[0]?.message?.content ?? null
  } catch { return null }
}

async function tryZai(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 25000)
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })), { role: 'user', content: fullPrompt }]
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${ZAI_API_KEY}`, 'X-Z-AI-From': 'Z' }
    if (process.env.ZAI_CHAT_ID) headers['X-Chat-Id'] = process.env.ZAI_CHAT_ID
    if (process.env.ZAI_USER_ID) headers['X-User-Id'] = process.env.ZAI_USER_ID
    if (process.env.ZAI_TOKEN) headers['X-Token'] = process.env.ZAI_TOKEN
    const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ messages, thinking: { type: 'disabled' } }) })
    clearTimeout(timeout); if (!res.ok) return null
    const json = await res.json(); return json?.choices?.[0]?.message?.content ?? null
  } catch { return null }
}

async function tryZaiSdk(history: { role: 'user' | 'model'; text: string }[], fullPrompt: string): Promise<string | null> {
  try {
    const ZAIModule = await import('z-ai-web-dev-sdk')
    const ZAI = ZAIModule.default
    const zai = new ZAI({
      baseUrl: process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1',
      apiKey: process.env.ZAI_API_KEY || 'Z.ai',
      token: process.env.ZAI_TOKEN || '',
      chatId: process.env.ZAI_CHAT_ID || '',
      userId: process.env.ZAI_USER_ID || '',
    })
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.text })), { role: 'user', content: fullPrompt }]
    const res = await zai.chat.completions.create({ messages })
    return res.choices[0]?.message?.content ?? null
  } catch { return null }
}
