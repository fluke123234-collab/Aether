/** Aether · /api/export — beautiful PDF book of all memories */
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
  const { data: rows, error } = await userClient.from('memories').select('id, title, body, summary, tags, created_at, category').eq('user_id', authData.user.id).order('created_at', { ascending: true })
  if (error) { logger.warn('Aether · export failed:', error.message); return NextResponse.json({ error: error.message }, { status: 500 }) }

  const memories = (rows ?? []).map((r) => ({ id: r.id, title: r.title || 'Untitled', body: r.body || '', summary: r.summary, tags: r.tags, created_at: r.created_at, category: r.category || 'note' }))
  const pdfBytes = generateBookPdf(memories)
  const dateStr = new Date().toISOString().split('T')[0]
  return new NextResponse(pdfBytes, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="aether-sanctuary-${dateStr}.pdf"`, 'Content-Length': String(pdfBytes.byteLength) } })
}

function escapePdf(s: string): string { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') }
function wrapText(text: string, maxChars: number): string[] { const words = text.split(/\s+/); const lines: string[] = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars) { if (cur) lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim() } if (cur) lines.push(cur); return lines }

// Color constants (RGB 0-1)
const C = {
  purple: '0.486 0.310 0.918',
  purpleLight: '0.95 0.92 1.0',
  purpleMid: '0.37 0.18 0.56',
  dark: '0.08 0.08 0.11',
  body: '0.2 0.2 0.23',
  muted: '0.55 0.55 0.58',
  mutedLight: '0.7 0.7 0.72',
  white: '1 1 1',
  cardBg: '0.97 0.96 0.98',
  divider: '0.9 0.89 0.92',
  dateBg: '0.93 0.91 0.96',
  emerald: '0.055 0.4 0.31',
  emeraldLight: '0.92 0.97 0.95',
}

function generateBookPdf(memories: { title: string; body: string; summary: string | null; tags: string[] | null; created_at: string; category: string }[]): Uint8Array {
  const pageWidth = 595, pageHeight = 842, margin = 64, contentWidth = pageWidth - margin * 2
  const objects: string[] = []
  const contentOps: string[] = []
  let cursorY = pageHeight - margin
  let pageNum = 1
  const minCursorY = margin + 40

  function newPage() {
    // Footer with page number + branding
    contentOps.push(C.mutedLight + ' rg', 'BT /F1 8 Tf', `1 0 0 1 ${pageWidth / 2 - 10} 36 Tm`, `(${pageNum}) Tj ET`)
    contentOps.push(C.mutedLight + ' rg', 'BT /F1 7 Tf', `1 0 0 1 ${margin} 36 Tm`, `(Aether — a quieter place to think) Tj ET`)
    // Top accent line
    contentOps.push(C.purple + ' rg', `${margin} ${pageHeight - margin + 8} 40 1.5 re f`)
    pageNum++
    cursorY = pageHeight - margin - 10
  }

  // ═══ COVER PAGE ═══
  cursorY = pageHeight / 2 + 80
  // Purple accent bar
  contentOps.push(C.purple + ' rg', `${margin} ${cursorY} 50 4 re f`)
  cursorY -= 40
  // Title
  contentOps.push(C.dark + ' rg', 'BT /F3 42 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Aether) Tj ET`)
  cursorY -= 55
  // Subtitle
  contentOps.push(C.muted + ' rg', 'BT /F2 16 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Your sanctuary, kept.) Tj ET`)
  cursorY -= 30
  // Date + count
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  contentOps.push(C.muted + ' rg', 'BT /F1 10 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(memories.length + ' thoughts  ·  exported ' + exportDate)}) Tj ET`)
  cursorY -= 25
  // Decorative line
  contentOps.push(C.divider + ' rg', `${margin} ${cursorY} ${contentWidth} 0.5 re f`)

  newPage()

  // ═══ TABLE OF CONTENTS ═══
  cursorY = pageHeight - margin - 10
  contentOps.push(C.purple + ' rg', `${margin} ${cursorY} 30 2 re f`)
  cursorY -= 28
  contentOps.push(C.dark + ' rg', 'BT /F3 22 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Contents) Tj ET`)
  cursorY -= 30

  // Group by date
  const byDate = new Map<string, number>()
  for (const m of memories) {
    const d = new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    byDate.set(d, (byDate.get(d) || 0) + 1)
  }

  for (const [date, count] of byDate) {
    if (cursorY < minCursorY) newPage()
    contentOps.push(C.muted + ' rg', 'BT /F1 10 Tf', `1 0 0 1 ${margin + 8} ${cursorY} Tm`, `(${escapePdf(date)}) Tj ET`)
    contentOps.push(C.purpleMid + ' rg', 'BT /F2 10 Tf', `1 0 0 1 ${pageWidth - margin - 60} ${cursorY} Tm`, `(${count} thought${count > 1 ? 's' : ''}) Tj ET`)
    // Dotted line
    contentOps.push(C.divider + ' rg', `${margin + 8} ${cursorY - 3} ${contentWidth - 80} 0.3 re f`)
    cursorY -= 20
  }

  newPage()

  // ═══ MEMORY ENTRIES ═══
  for (let idx = 0; idx < memories.length; idx++) {
    const m = memories[idx]
    if (cursorY < minCursorY + 120) newPage()

    // Date badge (pill shape)
    const mDate = new Date(m.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const mTime = new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const dateWidth = 200
    contentOps.push(C.dateBg + ' rg', `${margin} ${cursorY - 12} ${dateWidth} 18 re f`)
    contentOps.push(C.purpleMid + ' rg', 'BT /F2 8 Tf', `1 0 0 1 ${margin + 8} ${cursorY - 6} Tm`, `(${escapePdf(mDate + '  ·  ' + mTime)}) Tj ET`)
    cursorY -= 28

    // Title
    contentOps.push(C.dark + ' rg')
    for (const line of wrapText(m.title, 44)) {
      if (cursorY < minCursorY) newPage()
      contentOps.push('BT /F3 18 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(line)}) Tj ET`)
      cursorY -= 24
    }
    cursorY -= 8

    // Body text
    contentOps.push(C.body + ' rg')
    for (const line of wrapText(m.body.replace(/\s*\[Image content:[\s\S]*?\]\s*/g, '').trim() || m.body, 82)) {
      if (cursorY < minCursorY) newPage()
      contentOps.push('BT /F1 11 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(line)}) Tj ET`)
      cursorY -= 16
    }
    cursorY -= 10

    // Summary card (if exists)
    if (m.summary?.trim()) {
      if (cursorY < minCursorY + 60) newPage()
      const summaryLines = wrapText(m.summary, 80)
      const cardHeight = Math.max(50, summaryLines.length * 14 + 24)
      // Card background
      contentOps.push(C.purpleLight + ' rg', `${margin} ${cursorY - cardHeight} ${contentWidth} ${cardHeight} re f`)
      // Left accent bar
      contentOps.push(C.purple + ' rg', `${margin} ${cursorY - cardHeight} 3 ${cardHeight} re f`)
      // Label
      contentOps.push(C.purpleMid + ' rg', 'BT /F2 8 Tf', `1 0 0 1 ${margin + 14} ${cursorY - 14} Tm`, `(REFLECTION) Tj ET`)
      // Summary text
      contentOps.push(C.purpleMid + ' rg')
      let sy = cursorY - 28
      for (const line of summaryLines) {
        contentOps.push('BT /F1 9 Tf', `1 0 0 1 ${margin + 14} ${sy} Tm`, `(${escapePdf(line)}) Tj ET`)
        sy -= 13
      }
      cursorY -= cardHeight + 12
    }

    // Tags
    const tags = m.tags ?? []
    if (tags.length && tags.some(t => t !== 'capture')) {
      if (cursorY < minCursorY + 20) newPage()
      const displayTags = tags.filter(t => t !== 'capture')
      if (displayTags.length) {
        contentOps.push(C.muted + ' rg', 'BT /F1 8 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(displayTags.map(t => '#' + t).join('   '))}) Tj ET`)
        cursorY -= 18
      }
    }

    // Divider
    cursorY -= 8
    if (cursorY > minCursorY) {
      contentOps.push(C.divider + ' rg', `${margin} ${cursorY} ${contentWidth * 0.3} 0.5 re f`)
      cursorY -= 22
    }
  }

  // ═══ BACK COVER ═══
  newPage()
  cursorY = pageHeight / 2 + 20
  contentOps.push(C.purple + ' rg', `${margin} ${cursorY} 40 3 re f`)
  cursorY -= 35
  contentOps.push(C.dark + ' rg', 'BT /F3 24 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Your mind,) Tj ET`)
  cursorY -= 32
  contentOps.push(C.dark + ' rg', 'BT /F3 24 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(kept forever.) Tj ET`)
  cursorY -= 40
  contentOps.push(C.muted + ' rg', 'BT /F2 12 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(memories.length + ' thoughts preserved through Aether.')}) Tj ET`)
  cursorY -= 25
  contentOps.push(C.mutedLight + ' rg', 'BT /F1 9 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(A quieter place to think.) Tj ET`)

  // Last page footer
  contentOps.push(C.mutedLight + ' rg', 'BT /F1 8 Tf', `1 0 0 1 ${pageWidth / 2 - 10} 36 Tm`, `(${pageNum}) Tj ET`)

  // ═══ BUILD PDF ═══
  const stream = contentOps.join('\n')
  objects.push(
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>'
  )

  let pdf = '%PDF-1.4\n'
  const xref: number[] = []
  for (let i = 0; i < objects.length; i++) { xref.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const xs = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of xref) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xs}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
