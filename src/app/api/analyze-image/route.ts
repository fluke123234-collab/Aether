/** Aether · /api/analyze-image — VLM image analysis via z-ai-web-dev-sdk */
import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VLM_PROMPT = `Analyze this image with extreme detail and accuracy. This is critical — be thorough.

1. EXTRACT ALL TEXT: Every word, number, price, label, spec, title, heading visible in the image. Transcribe verbatim, preserving exact numbers and prices.
2. DESCRIBE CONTENT: What is shown? Products, parts, documents, receipts, screenshots, diagrams? List each item with its details (name, price, specs, quantities).
3. KEYWORDS: List 5-10 keywords that describe this image (for searchability).
4. SUMMARIZE: One sentence summary of what this image contains.

Output plain text, no JSON. Be exhaustive — every detail matters. If there are prices, list them. If there are part names, list them. If there are specs, list them.`

export async function POST(req: NextRequest) {
  let body: { image?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ success: false, description: '', error: 'invalid_json' }, { status: 400 }) }

  const image = typeof body.image === 'string' ? body.image : ''
  if (!image || !image.startsWith('data:image/')) return NextResponse.json({ success: false, description: '', error: 'no_image' }, { status: 400 })

  try {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    // Pass config explicitly so it works on Vercel (no /etc/.z-ai-config).
    const zai = await ZAI.create({
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
