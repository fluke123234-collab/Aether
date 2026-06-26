/** Aether · /api/analyze-image — VLM image analysis via Groq vision */
import { NextRequest, NextResponse } from 'next/server'
import { groqVision } from '@/lib/ai'

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

  const description = await groqVision(VLM_PROMPT, image, { timeoutMs: 8000 })

  if (description) {
    return NextResponse.json({ success: true, description })
  }

  return NextResponse.json({ success: false, description: '', error: 'analysis_failed' }, { status: 500 })
}
