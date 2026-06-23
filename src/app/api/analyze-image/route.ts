/** Aether · /api/analyze-image — VLM image analysis via z-ai-web-dev-sdk */
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VLM_PROMPT = `Analyze this image within the context of a personal thought sanctuary. Act as a cognitive extension. Do not just list items. Extract handwritten text (OCR), identify the emotional vibe, describe any background notes, documents, or scenery, and generate a dense list of relational keywords. Return a comprehensive text summary that will be stored directly inside the memory's embedding vector so it can be perfectly retrieved via semantic natural language search later.

Structure your response as:
1. OCR TEXT: Transcribe every word, number, label, price, heading, and handwritten note visible. Preserve exact figures.
2. SCENE & CONTENT: What is shown — products, documents, receipts, screenshots, diagrams, photos, scenery? Describe each item with its details (name, price, specs, quantities, colors, textures).
3. EMOTIONAL VIBE: The mood or feeling the image conveys (e.g., "calm minimalism", "urgent clutter", "warm nostalgia"). One phrase.
4. RELATIONAL KEYWORDS: 8-15 dense keywords and short phrases that capture concepts, objects, themes, and entities — optimized for semantic search retrieval.
5. SEMANTIC SUMMARY: 2-3 sentences weaving the content, vibe, and key entities into a rich narrative description.

Output plain text, no JSON. Be exhaustive and relational — this text will be embedded for natural language search.`

export async function POST(req: NextRequest) {
  let body: { image?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ success: false, description: '', error: 'invalid_json' }, { status: 400 }) }

  const image = typeof body.image === 'string' ? body.image : ''
  if (!image || !image.startsWith('data:image/')) return NextResponse.json({ success: false, description: '', error: 'no_image' }, { status: 400 })

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
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    const desc = res.choices[0]?.message?.content ?? ''
    if (desc) return NextResponse.json({ success: true, description: desc })
  } catch (err) {
    logger.warn('Aether · VLM failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ success: false, description: '', error: 'Could not analyze the image.' }, { status: 500 })
}
