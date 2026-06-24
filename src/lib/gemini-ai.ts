/**
 * Aether · Google Gemini AI utility
 * ------------------------------------------------------------
 * Uses @google/generative-ai with gemini-2.0-flash.
 * Works on Vercel — no internal endpoints, no proxies.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const MODEL_NAME = 'gemini-2.0-flash'

let aiInstance: GoogleGenerativeAI | null = null
function getAI() {
  if (aiInstance) return aiInstance
  aiInstance = new GoogleGenerativeAI(GEMINI_API_KEY)
  return aiInstance
}

/**
 * Text completion using Gemini.
 */
export async function geminiText(
  prompt: string,
  systemPrompt?: string,
  timeoutMs = 6000
): Promise<string | null> {
  try {
    const ai = getAI()
    const model = ai.getGenerativeModel({
      model: MODEL_NAME,
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    })

    const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), timeoutMs))
    const result = await Promise.race([
      model.generateContent(prompt),
      timeoutPromise,
    ])

    if (!result) return null
    return result.response.text().trim()
  } catch (err) {
    console.warn('Aether · Gemini text failed:', err instanceof Error ? err.message.slice(0, 100) : err)
    return null
  }
}

/**
 * Vision analysis using Gemini (gemini-2.0-flash supports vision).
 */
export async function geminiVision(
  prompt: string,
  base64Data: string,
  mimeType: string,
  timeoutMs = 8000
): Promise<string> {
  try {
    const ai = getAI()
    const model = ai.getGenerativeModel({ model: MODEL_NAME })

    // Strip the data URL prefix if present
    const base64 = base64Data.startsWith('data:')
      ? base64Data.split(',')[1]
      : base64Data

    const imagePart = {
      inlineData: { data: base64, mimeType: mimeType || 'image/jpeg' },
    }

    const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), timeoutMs))
    const result = await Promise.race([
      model.generateContent([prompt, imagePart]),
      timeoutPromise,
    ])

    if (!result) return ''
    return result.response.text().trim()
  } catch (err) {
    console.warn('Aether · Gemini vision failed:', err instanceof Error ? err.message.slice(0, 100) : err)
    return ''
  }
}

/**
 * Strip markdown code fences.
 */
export function stripFences(raw: string): string {
  let c = raw.trim()
  if (c.startsWith('```')) c = c.replace(/^```(?:json|text|html)?\s*/i, '').replace(/\s*```$/, '')
  return c
}
