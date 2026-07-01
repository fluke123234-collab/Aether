/** Aether · PDF generation utility — beautiful single memory PDF */
export type PrintableMemory = { title: string; body: string; summary: string | null; tags: string[] | null; created_at: string }

function escapePdfText(s: string): string { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') }
function wrapText(text: string, maxChars: number): string[] { const words = text.split(/\s+/); const lines: string[] = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars) { if (cur) lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim() } if (cur) lines.push(cur); return lines }

const C = {
  purple: '0.486 0.310 0.918',
  purpleLight: '0.95 0.92 1.0',
  purpleMid: '0.37 0.18 0.56',
  dark: '0.08 0.08 0.11',
  body: '0.2 0.2 0.23',
  muted: '0.55 0.55 0.58',
  mutedLight: '0.7 0.7 0.72',
  divider: '0.9 0.89 0.92',
  dateBg: '0.93 0.91 0.96',
}

export function generateMemoryPdf(memory: PrintableMemory): Uint8Array {
  const pageWidth = 595, pageHeight = 842, margin = 64, contentWidth = pageWidth - margin * 2
  let cursorY = pageHeight - margin
  const contentOps: string[] = []

  // Top accent bar
  contentOps.push(C.purple + ' rg', `${margin} ${cursorY} 40 3 re f`)
  cursorY -= 28
  // Brand
  contentOps.push(C.muted + ' rg', 'BT /F2 13 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Aether) Tj ET`)
  cursorY -= 22
  // Date badge
  const mDate = new Date(memory.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const dateWidth = 300
  contentOps.push(C.dateBg + ' rg', `${margin} ${cursorY - 12} ${dateWidth} 18 re f`)
  contentOps.push(C.purpleMid + ' rg', 'BT /F2 8 Tf', `1 0 0 1 ${margin + 8} ${cursorY - 6} Tm`, `(${escapePdfText(mDate)}) Tj ET`)
  cursorY -= 32

  // Title (large serif)
  contentOps.push(C.dark + ' rg')
  for (const line of wrapText(memory.title || 'Untitled thought', 44)) { contentOps.push('BT /F3 24 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdfText(line)}) Tj ET`); cursorY -= 30 }
  cursorY -= 16

  // Divider
  contentOps.push(C.divider + ' rg', `${margin} ${cursorY} ${contentWidth} 0.5 re f`)
  cursorY -= 24

  // Body
  contentOps.push(C.body + ' rg')
  for (const line of wrapText(memory.body.replace(/\s*\[Image content:[\s\S]*?\]\s*/g, '').trim() || memory.body, 78)) { contentOps.push('BT /F1 11 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdfText(line)}) Tj ET`); cursorY -= 17 }
  cursorY -= 20

  // Summary card (luxury)
  if (memory.summary?.trim()) {
    const summaryLines = wrapText(memory.summary, 80)
    const cardHeight = Math.max(50, summaryLines.length * 14 + 24)
    contentOps.push(C.purpleLight + ' rg', `${margin} ${cursorY - cardHeight} ${contentWidth} ${cardHeight} re f`)
    contentOps.push(C.purple + ' rg', `${margin} ${cursorY - cardHeight} 3 ${cardHeight} re f`)
    contentOps.push(C.purpleMid + ' rg', 'BT /F2 8 Tf', `1 0 0 1 ${margin + 14} ${cursorY - 14} Tm`, `(REFLECTION) Tj ET`)
    contentOps.push(C.purpleMid + ' rg')
    let sy = cursorY - 28
    for (const line of summaryLines) { contentOps.push('BT /F1 9 Tf', `1 0 0 1 ${margin + 14} ${sy} Tm`, `(${escapePdfText(line)}) Tj ET`); sy -= 13 }
    cursorY -= cardHeight + 12
  }

  // Tags
  const tags = (memory.tags ?? []).filter(t => t !== 'capture')
  if (tags.length) {
    contentOps.push(C.muted + ' rg', 'BT /F1 8 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdfText(tags.map(t => '#' + t).join('   '))}) Tj ET`)
    cursorY -= 20
  }

  // Footer
  cursorY = 48
  contentOps.push(C.mutedLight + ' rg', 'BT /F1 8 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(Kept in Aether — a quieter place to think) Tj ET`)
  contentOps.push(C.purple + ' rg', `${margin} 42 30 1 re f`)

  const stream = contentOps.join('\n')
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>',
  ]
  let pdf = '%PDF-1.4\n'; const xrefOffsets: number[] = []
  for (let i = 0; i < objects.length; i++) { xrefOffsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of xrefOffsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
