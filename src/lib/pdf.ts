/** Aether · PDF generation utility — single memory PDF */
export type PrintableMemory = { title: string; body: string; summary: string | null; tags: string[] | null; created_at: string }

function escapePdfText(s: string): string { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') }
function wrapText(text: string, maxChars: number): string[] { const words = text.split(/\s+/); const lines: string[] = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > maxChars) { if (cur) lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim() } if (cur) lines.push(cur); return lines }

export function generateMemoryPdf(memory: PrintableMemory): Uint8Array {
  const pageWidth = 595, pageHeight = 842, margin = 72, contentWidth = pageWidth - margin * 2
  let cursorY = pageHeight - margin
  const contentOps: string[] = []

  contentOps.push('0.486 0.310 0.918 rg', `${margin} ${cursorY} 40 3 re f`); cursorY -= 24
  contentOps.push('0.4 0.4 0.43 rg', 'BT /F2 13 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdfText('Aether')}) Tj ET`); cursorY -= 28
  contentOps.push('0.55 0.55 0.58 rg', 'BT /F1 8 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdfText('A kept thought · ' + new Date(memory.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))}) Tj ET`); cursorY -= 30

  contentOps.push('0.08 0.08 0.11 rg')
  for (const line of wrapText(memory.title || 'Untitled thought', 48)) { contentOps.push('BT /F3 22 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdfText(line)}) Tj ET`); cursorY -= 28 }
  cursorY -= 16

  contentOps.push('0.2 0.2 0.23 rg')
  for (const line of wrapText(memory.body || '', 78)) { contentOps.push('BT /F1 11 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `1.5 TL (${escapePdfText(line)}) Tj ET`); cursorY -= 17 }
  cursorY -= 20

  if (memory.summary?.trim()) {
    contentOps.push('0.95 0.92 1.0 rg', `${margin} ${cursorY - 60} ${contentWidth} 70 re f`)
    contentOps.push('0.486 0.310 0.918 rg', 'BT /F2 9 Tf', `1 0 0 1 ${margin + 16} ${cursorY - 18} Tm`, `(${escapePdfText('Reflection')}) Tj ET`)
    contentOps.push('0.37 0.18 0.56 rg'); let sy = cursorY - 36
    for (const line of wrapText(memory.summary, 80)) { contentOps.push('BT /F1 9 Tf', `1 0 0 1 ${margin + 16} ${sy} Tm`, `(${escapePdfText(line)}) Tj ET`); sy -= 14 }
    cursorY -= 90
  }

  const tags = memory.tags ?? []
  if (tags.length) { contentOps.push('0.55 0.55 0.58 rg', 'BT /F1 9 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdfText('Tags: ' + tags.join('  ·  '))}) Tj ET`); cursorY -= 20 }

  cursorY = margin
  contentOps.push('0.7 0.7 0.72 rg', 'BT /F1 8 Tf', `1 0 0 1 ${margin} ${cursorY} Tm`, `(${escapePdfText('Kept in Aether — a quieter place to think')}) Tj ET`)

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
