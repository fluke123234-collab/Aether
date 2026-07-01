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
  const { data: rows, error } = await userClient.from('memories').select('id, title, body, summary, tags, created_at, category, metadata').eq('user_id', authData.user.id).order('created_at', { ascending: true })
  if (error) { logger.warn('Aether · export failed:', error.message); return NextResponse.json({ error: error.message }, { status: 500 }) }

  const memories = (rows ?? []).map((r) => ({ id: r.id, title: r.title || 'Untitled', body: r.body || '', summary: r.summary, tags: r.tags, created_at: r.created_at, category: r.category || 'note', metadata: r.metadata as { imageDescription?: string; transcription?: string } | null }))
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

function generateBookPdf(memories: { title: string; body: string; summary: string | null; tags: string[] | null; created_at: string; category: string; metadata: { imageDescription?: string; transcription?: string } | null }[]): Uint8Array {
  const pageWidth = 595, pageHeight = 842, margin = 64, contentWidth = pageWidth - margin * 2
  const objects: string[] = []
  const contentOps: string[] = []
  let cursorY = pageHeight - margin
  let pageNum = 1
  const minCursorY = margin + 40

  function newPage() {
    contentOps.push(C.mutedLight + ' rg', 'BT /F1 8 Tf', `1 0 0 1 ${pageWidth / 2 - 10} 36 Tm`, `(${pageNum}) Tj ET`)
    contentOps.push(C.mutedLight + ' rg', 'BT /F1 7 Tf', `1 0 0 1 ${margin} 36 Tm`, `(Aether) Tj ET`)
    contentOps.push(C.purple + ' rg', `${margin} ${pageHeight - margin + 8} 40 1.5 re f`)
    pageNum++
    cursorY = pageHeight - margin - 10
  }

  // ═══ COVER PAGE ═══
  cursorY = pageHeight / 2 + 100
  contentOps.push(C.purple + ' rg', `${margin} ${cursorY} 50 4 re f`)
  cursorY -= 40
  contentOps.push(C.dark + ' rg', 'BT /F3 42 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Aether) Tj ET`)
  cursorY -= 55
  contentOps.push(C.muted + ' rg', 'BT /F2 16 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Your sanctuary, kept.) Tj ET`)
  cursorY -= 30
  const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  contentOps.push(C.muted + ' rg', 'BT /F1 10 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(memories.length + ' thoughts  ·  exported ' + exportDate)}) Tj ET`)
  cursorY -= 25
  contentOps.push(C.divider + ' rg', `${margin} ${cursorY} ${contentWidth} 0.5 re f`)
  cursorY -= 25
  // Cover quote
  contentOps.push(C.purpleMid + ' rg', 'BT /F3 13 Tf', `1 0 0 1 ${margin + 20} ${cursorY} Tm`, `(Luxury is the absence of friction,) Tj ET`)
  cursorY -= 20
  contentOps.push(C.purpleMid + ' rg', 'BT /F3 13 Tf', `1 0 0 1 ${margin + 20} ${cursorY} Tm`, `(felt as ease.) Tj ET`)

  newPage()

  // ═══ SANCTUARY STATISTICS PAGE ═══
  cursorY = pageHeight - margin - 10
  contentOps.push(C.purple + ' rg', `${margin} ${cursorY} 30 2 re f`)
  cursorY -= 28
  contentOps.push(C.dark + ' rg', 'BT /F3 22 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Sanctuary Statistics) Tj ET`)
  cursorY -= 35

  // Calculate stats
  const totalWords = memories.reduce((sum, m) => sum + (m.body || '').split(/\s+/).filter(w => w.length > 0).length, 0)
  const totalChars = memories.reduce((sum, m) => sum + (m.body || '').length, 0)
  const tagCount = new Map<string, number>()
  for (const m of memories) { for (const t of (m.tags ?? [])) { if (t !== 'capture') tagCount.set(t, (tagCount.get(t) || 0) + 1) } }
  const topTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const dateRange = memories.length > 0 ? `${new Date(memories[0].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — ${new Date(memories[memories.length - 1].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : '—'
  const imageCount = memories.filter(m => m.metadata?.imageDescription).length
  const voiceCount = memories.filter(m => m.metadata?.transcription || (m.tags ?? []).includes('voice')).length
  const textCount = memories.length - imageCount - voiceCount

  // Stats grid (2 columns)
  const stats = [
    { label: 'Total Thoughts', value: String(memories.length) },
    { label: 'Total Words', value: totalWords.toLocaleString() },
    { label: 'Date Range', value: dateRange },
    { label: 'Text Notes', value: String(textCount) },
    { label: 'Image Captures', value: String(imageCount) },
    { label: 'Voice Notes', value: String(voiceCount) },
  ]

  for (let i = 0; i < stats.length; i++) {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * (contentWidth / 2 + 10)
    const y = cursorY - row * 70
    // Card background
    contentOps.push(C.cardBg + ' rg', `${x} ${y - 50} ${contentWidth / 2 - 10} 55 re f`)
    // Left accent
    contentOps.push(C.purple + ' rg', `${x} ${y - 50} 2.5 55 re f`)
    // Label
    contentOps.push(C.muted + ' rg', 'BT /F2 8 Tf', `1 0 0 1 ${x + 12} ${y - 14} Tm`, `(${escapePdf(stats[i].label.toUpperCase())}) Tj ET`)
    // Value
    contentOps.push(C.dark + ' rg', 'BT /F3 16 Tf', `1 0 0 1 ${x + 12} ${y - 36} Tm`, `(${escapePdf(stats[i].value)}) Tj ET`)
  }
  cursorY -= 3 * 70 + 10

  // Top tags
  if (topTags.length > 0) {
    if (cursorY < minCursorY + 80) newPage()
    contentOps.push(C.dark + ' rg', 'BT /F3 14 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Most Used Tags) Tj ET`)
    cursorY -= 24
    for (const [tag, count] of topTags) {
      if (cursorY < minCursorY) newPage()
      // Tag pill
      const tagText = `#${tag}`
      contentOps.push(C.dateBg + ' rg', `${margin} ${cursorY - 10} 120 18 re f`)
      contentOps.push(C.purpleMid + ' rg', 'BT /F2 9 Tf', `1 0 0 1 ${margin + 8} ${cursorY - 4} Tm`, `(${escapePdf(tagText)}) Tj ET`)
      // Count
      contentOps.push(C.muted + ' rg', 'BT /F1 9 Tf', `1 0 0 1 ${margin + 140} ${cursorY - 4} Tm`, `(${count} thought${count > 1 ? 's' : ''}) Tj ET`)
      cursorY -= 24
    }
  }

  newPage()

  // ═══ TABLE OF CONTENTS ═══
  cursorY = pageHeight - margin - 10
  contentOps.push(C.purple + ' rg', `${margin} ${cursorY} 30 2 re f`)
  cursorY -= 28
  contentOps.push(C.dark + ' rg', 'BT /F3 22 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Contents) Tj ET`)
  cursorY -= 30

  const byDate = new Map<string, { count: number; titles: string[] }>()
  for (const m of memories) {
    const d = new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    if (!byDate.has(d)) byDate.set(d, { count: 0, titles: [] })
    const entry = byDate.get(d)!
    entry.count++
    if (entry.titles.length < 3) entry.titles.push(m.title)
  }

  for (const [date, info] of byDate) {
    if (cursorY < minCursorY + 60) newPage()
    // Date header
    contentOps.push(C.purpleMid + ' rg', 'BT /F2 11 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(date)}) Tj ET`)
    contentOps.push(C.muted + ' rg', 'BT /F1 9 Tf', `1 0 0 1 ${pageWidth - margin - 60} ${cursorY} Tm`, `(${info.count} thought${info.count > 1 ? 's' : ''}) Tj ET`)
    cursorY -= 16
    // Preview titles
    contentOps.push(C.muted + ' rg')
    for (const title of info.titles) {
      contentOps.push('BT /F1 9 Tf', `1 0 0 1 ${margin + 12} ${cursorY} Tm`, `(${escapePdf('· ' + title.slice(0, 50))}) Tj ET`)
      cursorY -= 13
    }
    cursorY -= 8
    contentOps.push(C.divider + ' rg', `${margin} ${cursorY} ${contentWidth} 0.3 re f`)
    cursorY -= 14
  }

  newPage()

  // ═══ MEMORY ENTRIES ═══
  for (let idx = 0; idx < memories.length; idx++) {
    const m = memories[idx]
    if (cursorY < minCursorY + 120) newPage()

    // Date badge
    const mDate = new Date(m.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const mTime = new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const dateWidth = 220
    contentOps.push(C.dateBg + ' rg', `${margin} ${cursorY - 12} ${dateWidth} 18 re f`)
    contentOps.push(C.purpleMid + ' rg', 'BT /F2 8 Tf', `1 0 0 1 ${margin + 8} ${cursorY - 6} Tm`, `(${escapePdf(mDate + '  ·  ' + mTime)}) Tj ET`)
    // Entry number
    contentOps.push(C.mutedLight + ' rg', 'BT /F1 8 Tf', `1 0 0 1 ${pageWidth - margin - 30} ${cursorY - 6} Tm`, `(${idx + 1}/${memories.length}) Tj ET`)
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

    // Image description card (if exists)
    const imgDesc = m.metadata?.imageDescription?.trim()
    if (imgDesc) {
      if (cursorY < minCursorY + 60) newPage()
      const descLines = wrapText(imgDesc, 78)
      const cardHeight = Math.max(45, descLines.length * 13 + 22)
      contentOps.push(C.cardBg + ' rg', `${margin} ${cursorY - cardHeight} ${contentWidth} ${cardHeight} re f`)
      contentOps.push(C.emerald + ' rg', `${margin} ${cursorY - cardHeight} 3 ${cardHeight} re f`)
      contentOps.push(C.emerald + ' rg', 'BT /F2 8 Tf', `1 0 0 1 ${margin + 14} ${cursorY - 14} Tm`, `(IMAGE ANALYSIS) Tj ET`)
      contentOps.push(C.body + ' rg')
      let sy = cursorY - 26
      for (const line of descLines) { contentOps.push('BT /F1 9 Tf', `1 0 0 1 ${margin + 14} ${sy} Tm`, `(${escapePdf(line)}) Tj ET`); sy -= 13 }
      cursorY -= cardHeight + 10
    }

    // Summary / reflection card (if exists)
    if (m.summary?.trim()) {
      if (cursorY < minCursorY + 60) newPage()
      const summaryLines = wrapText(m.summary, 80)
      const cardHeight = Math.max(50, summaryLines.length * 14 + 24)
      contentOps.push(C.purpleLight + ' rg', `${margin} ${cursorY - cardHeight} ${contentWidth} ${cardHeight} re f`)
      contentOps.push(C.purple + ' rg', `${margin} ${cursorY - cardHeight} 3 ${cardHeight} re f`)
      contentOps.push(C.purpleMid + ' rg', 'BT /F2 8 Tf', `1 0 0 1 ${margin + 14} ${cursorY - 14} Tm`, `(REFLECTION) Tj ET`)
      contentOps.push(C.purpleMid + ' rg')
      let sy = cursorY - 28
      for (const line of summaryLines) { contentOps.push('BT /F1 9 Tf', `1 0 0 1 ${margin + 14} ${sy} Tm`, `(${escapePdf(line)}) Tj ET`); sy -= 13 }
      cursorY -= cardHeight + 12
    }

    // Tags
    const tags = (m.tags ?? []).filter(t => t !== 'capture')
    if (tags.length) {
      if (cursorY < minCursorY + 20) newPage()
      contentOps.push(C.muted + ' rg', 'BT /F1 8 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(tags.map(t => '#' + t).join('   '))}) Tj ET`)
      cursorY -= 18
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
  cursorY = pageHeight / 2 + 40
  contentOps.push(C.purple + ' rg', `${margin} ${cursorY} 40 3 re f`)
  cursorY -= 35
  contentOps.push(C.dark + ' rg', 'BT /F3 24 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Your mind,) Tj ET`)
  cursorY -= 32
  contentOps.push(C.dark + ' rg', 'BT /F3 24 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(kept forever.) Tj ET`)
  cursorY -= 40
  contentOps.push(C.muted + ' rg', 'BT /F2 12 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(memories.length + ' thoughts preserved through Aether.')}) Tj ET`)
  cursorY -= 25
  // Word count stat
  contentOps.push(C.mutedLight + ' rg', 'BT /F1 10 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdf(totalWords.toLocaleString() + ' words captured.')}) Tj ET`)
  cursorY -= 20
  contentOps.push(C.mutedLight + ' rg', 'BT /F1 9 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(A quieter place to think.) Tj ET`)

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
