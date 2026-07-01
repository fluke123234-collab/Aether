import { NextRequest, NextResponse } from 'next/server'
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024
export function checkPayloadSize(req: NextRequest): NextResponse | null {
  const cl = req.headers.get('content-length')
  if (cl && parseInt(cl, 10) > MAX_PAYLOAD_BYTES) return NextResponse.json({ success: false, error: 'Payload volume exceeds security threshold.' }, { status: 413 })
  return null
}
export function sanitizeInput(raw: string, maxLength = 10000): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\u0000]/g, '').replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, maxLength).trim()
}
export function sanitizeUrl(raw: string, maxLength = 2048): string {
  if (typeof raw !== 'string') return ''
  const c = sanitizeInput(raw, maxLength)
  if (!/^https?:\/\/[^\s]+$/i.test(c)) return ''
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|::1|\[::1\]/i.test(c)) return ''
  return c
}
export function sanitizeDataUrl(raw: string, maxBytes = 5 * 1024 * 1024): string {
  if (typeof raw !== 'string') return ''
  if (!/^data:(image\/[a-z+]+|audio\/[a-z+]+);base64,/i.test(raw)) return ''
  if ((raw.split(',')[1]?.length ?? 0) * 0.75 > maxBytes) return ''
  return raw
}
