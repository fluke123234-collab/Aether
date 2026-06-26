/**
 * Aether · AI Proxy Mini-Service
 * ------------------------------------------------------------
 * Runs on this container (which CAN reach internal-api.z.ai).
 * The Vercel app calls this proxy to access the Z.ai API.
 * 
 * Port: 3001
 */

import ZAI from 'z-ai-web-dev-sdk'

const PORT = 3001

let zaiInstance: any = null
async function getZai() {
  if (zaiInstance) return zaiInstance
  zaiInstance = await ZAI.create()
  return zaiInstance
}

function stripFences(raw: string): string {
  let c = raw.trim()
  if (c.startsWith('```')) c = c.replace(/^```(?:json|text|html)?\s*/i, '').replace(/\s*```$/, '')
  return c
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }

    try {
      const body = await req.json()
      const zai = await getZai()

      if (!zai) {
        return new Response(JSON.stringify({ error: 'AI init failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
      }

      // ── Vision request ──
      if (body.type === 'vision' && body.prompt && body.image) {
        const timeoutMs = body.timeoutMs || 8000
        const visionPromise = zai.chat.completions.createVision({
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: body.prompt },
              { type: 'image_url', image_url: { url: body.image } },
            ],
          }],
          thinking: { type: 'disabled' },
        })

        const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), timeoutMs))
        const res = await Promise.race([visionPromise, timeoutPromise])

        if (res) {
          const content = res.choices?.[0]?.message?.content ?? ''
          return new Response(JSON.stringify({ success: true, content: content.trim() }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          })
        }

        return new Response(JSON.stringify({ success: false, content: '' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
      }

      // ── Text request ──
      if (body.type === 'text' && body.messages) {
        const timeoutMs = body.timeoutMs || 6000
        const chatPromise = zai.chat.completions.create({ messages: body.messages })
        const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), timeoutMs))
        const res = await Promise.race([chatPromise, timeoutPromise])

        if (res) {
          const content = res.choices?.[0]?.message?.content ?? ''
          return new Response(JSON.stringify({ success: true, content: content.trim() }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          })
        }

        return new Response(JSON.stringify({ success: false, content: null }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
      }

      return new Response(JSON.stringify({ error: 'Invalid request type' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }
  },
})

console.log(`🚀 Aether AI Proxy running on port ${PORT}`)
