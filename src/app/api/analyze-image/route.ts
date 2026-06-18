/** Aether · /api/analyze-image — VLM image analysis via Z.ai vision API */
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ZAI_API_KEY = process.env.ZAI_API_KEY || ''
const ZAI_BASE_URL = process.env.ZAI_BASE_URL || 'https://internal-api.z.ai/v1'

const VLM_PROMPT = `Describe this image thoroughly. Extract ALL visible text verbatim (signs, labels, documents, screens, handwriting). Then describe the key visual content (objects, people, scenes, charts, diagrams). Be complete but concise. Plain text only — no JSON, no markdown.`

export async function POST(req: NextRequest) {
  let body: { image?: unknown }; try { body = await req.json() } catch { return NextResponse.json({ success: false, description: '', error: 'invalid_json' }, { status: 400 }) }
  const image = typeof body.image === 'string' ? body.image : ''
  if (!image || !image.startsWith('data:image/')) return NextResponse.json({ success: false, description: '', error: 'no_image' }, { status: 400 })

  if (ZAI_API_KEY) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${ZAI_API_KEY}`, 'X-Z-AI-From': 'Z' }
      if (process.env.ZAI_CHAT_ID) headers['X-Chat-Id'] = process.env.ZAI_CHAT_ID
      if (process.env.ZAI_USER_ID) headers['X-User-Id'] = process.env.ZAI_USER_ID
      if (process.env.ZAI_TOKEN) headers['X-Token'] = process.env.ZAI_TOKEN
      const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'user', content: [{ type: 'text', text: VLM_PROMPT }, { type: 'image_url', image_url: { url: image } }] }], thinking: { type: 'disabled' } }) })
      if (res.ok) { const json = await res.json(); const desc = json?.choices?.[0]?.message?.content ?? ''; if (desc) return NextResponse.json({ success: true, description: desc }) }
    } catch (err) { logger.warn('Aether · VLM failed:', err instanceof Error ? err.message : err) }
  }

  // Fallback: z-ai SDK
  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default; const zai = await ZAI.create()
    const res = await zai.chat.completions.createVision({ messages: [{ role: 'user', content: [{ type: 'text', text: VLM_PROMPT }, { type: 'image_url', image_url: { url: image } }] }], thinking: { type: 'disabled' } })
    const desc = res.choices[0]?.message?.content ?? ''; if (desc) return NextResponse.json({ success: true, description: desc })
  } catch (err) { logger.warn('Aether · VLM SDK failed:', err instanceof Error ? err.message : err) }

  return NextResponse.json({ success: false, description: '', error: 'Could not analyze the image.' }, { status: 500 })
}
