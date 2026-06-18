/** Aether · /api/export — full PDF book of all memories */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.startsWith('Bearer ') ? req.headers.get('authorization')!.slice(7) : null
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const userClient = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_ANON_KEY || 'placeholder-anon-key', { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: rows, error } = await userClient.from('memories').select('id, title, body, summary, tags, created_at').eq('user_id', authData.user.id).order('created_at', { ascending: true })
  if (error) { logger.warn('Aether · export failed:', error.message); return NextResponse.json({ error: error.message }, { status: 500 }) }

  const memories = (rows ?? []).map((r) => ({ id: r.id, title: r.title || 'Untitled', body: r.body || '', summary: r.summary, tags: r.tags, created_at: r.created_at }))
  const pdfBytes = generateBookPdf(memories)
  return new NextResponse(pdfBytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="aether-sanctuary.pdf"`, 'Content-Length': String(pdfBytes.byteLength) } })
}

function escapePdf(s: string): string { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') }
function wrapText(text: string, maxChars: number): string[] { const words = text.split(/\s+/); const lines: string[] = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars) { if (cur) lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim() } if (cur) lines.push(cur); return lines }

function generateBookPdf(memories: { title: string; body: string; summary: string | null; tags: string[] | null; created_at: string }[]): Uint8Array {
  const pageWidth = 595, pageHeight = 842, margin = 72, contentWidth = pageWidth - margin * 2
  const objects: string[] = []; const contentOps: string[] = []; let cursorY = pageHeight - margin; let pageNum = 1
  const minCursorY = margin + 30
  function newPage() { contentOps.push('0.7 0.7 0.72 rg', 'BT /F1 8 Tf', `1 0 0 1 ${pageWidth / 2} 40 Tm`, `(${pageNum}) Tj ET`); pageNum++; cursorY = pageHeight - margin }
  cursorY = pageHeight / 2 + 60
  contentOps.push('0.486 0.310 0.918 rg', `${margin} ${cursorY} 60 3 re f`); cursorY -= 30
  contentOps.push('0.08 0.08 0.11 rg', 'BT /F3 36 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf('Aether')}) Tj ET`); cursorY -= 50
  contentOps.push('0.4 0.4 0.43 rg', 'BT /F2 14 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf('Your sanctuary, kept.')}) Tj ET`); cursorY -= 25
  contentOps.push('0.55 0.55 0.58 rg', 'BT /F1 10 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(`${memories.length} thoughts · exported ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`)}) Tj ET`)
  newPage()
  for (const m of memories) {
    if (cursorY < minCursorY + 100) newPage()
    const mDate = new Date(m.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    contentOps.push('0.55 0.55 0.58 rg', 'BT /F1 8 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(mDate)}) Tj ET`); cursorY -= 22
    contentOps.push('0.08 0.08 0.11 rg')
    for (const line of wrapText(m.title, 42)) { if (cursorY < minCursorY) newPage(); contentOps.push('BT /F3 18 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(line)}) Tj ET`); cursorY -= 24 }
    cursorY -= 10
    contentOps.push('0.2 0.2 0.23 rg')
    for (const line of wrapText(m.body, 78)) { if (cursorY < minCursorY) newPage(); contentOps.push('BT /F1 11 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(line)}) Tj ET`); cursorY -= 16 }
    cursorY -= 12
    if (m.summary?.trim()) { if (cursorY < minCursorY + 60) newPage(); const sh = Math.max(50, wrapText(m.summary, 76).length * 14 + 20); contentOps.push('0.95 0.92 1.0 rg', `${margin} ${cursorY - sh} ${contentWidth} ${sh} re f`); contentOps.push('0.486 0.310 0.918 rg', 'BT /F2 9 Tf', `1 0 0 1 ${margin + 14} ${cursorY - 16} Tm`, `(${escapePdf('Reflection')}) Tj ET`); contentOps.push('0.37 0.18 0.56 rg'); let sy = cursorY - 32; for (const line of wrapText(m.summary, 76)) { contentOps.push('BT /F1 9 Tf', `1 0 0 1 ${margin + 14} ${sy} Tm`, `(${escapePdf(line)}) Tj ET`); sy -= 13 }; cursorY -= sh + 10 }
    const tags = m.tags ?? []; if (tags.length) { if (cursorY < minCursorY + 20) newPage(); contentOps.push('0.55 0.55 0.58 rg', 'BT /F1 9 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(tags.join('  ·  '))}) Tj ET`); cursorY -= 20 }
    cursorY -= 15; if (cursorY > minCursorY) { contentOps.push('0.9 0.9 0.92 rg', `${margin} ${cursorY} ${contentWidth / 3} 0.5 re f`); cursorY -= 25 }
  }
  contentOps.push('0.7 0.7 0.72 rg', 'BT /F1 8 Tf', `1 0 0 1 ${pageWidth / 2} 40 Tm`, `(${pageNum}) Tj ET`)
  objects.push('<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>`)
  const stream = contentOps.join('\n'); objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>')
  let pdf = '%PDF-1.4\n'; const xref: number[] = []
  for (let i = 0; i < objects.length; i++) { xref.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const xs = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`; for (const off of xref) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xs}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
