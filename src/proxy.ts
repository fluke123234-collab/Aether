import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
]
export function proxy(_req: NextRequest) {
  const r = NextResponse.next()
  for (const { key, value } of securityHeaders) r.headers.set(key, value)
  return r
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json|sw.js).*)'] }
