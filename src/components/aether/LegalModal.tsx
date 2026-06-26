'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type DocType = 'privacy' | 'manifesto' | 'contact' | null

const PRIVACY_TEXT = `Aether Data Privacy, Governance & Security Charter
Last Modified: June 2026

1. DATA ARCHITECTURE AND SECURE ISOLATION
Aether operates on a decentralized-first, hyper-encrypted pipeline configuration. When text fragments, digital assets, multi-format images, link summaries, or audio data streams are processed, they pass exclusively through transport-layer security (TLS 1.3) protocols directly into containerized, isolated instances within our cloud infrastructure database clusters.

2. MULTIMODAL INGESTION PRIVACY LOGIC
• Optical & Vision Processing Data: Binary image payload matrices processed via our multimodal engine strings are read strictly in-memory during inference cycles. Base64 representations are securely structured and stored inside private rows linked exclusively to your verified user profile.
• Acoustic Voice Captures: Raw voice memos and audio fragments uploaded to public cloud storage containers are assigned unguessable, high-entropy cryptographic hashes. Transcription summaries are fully localized inside indexed textual database cells to protect user privacy.
• Web-Scraping Content Layers: Scraped URL data strings and open-graph descriptive attributes are parsed in isolated serverless sandboxes. Aether does not sell, exchange, or monetize your indexed context maps to any third-party advertising brokers or analytics brokers.

3. USER DATA RIGHTS & COMPLETE PURGE CONTROLS
We maintain absolute user agency over all data. Users retain the unalterable right to issue an atomic delete request. Triggering a memory cell deletion executes a permanent cascade drop across the live database tables, instantly purging both text summaries and storage bucket objects.`

const MANIFESTO_TEXT = `The Aether Manifesto: The Antidote to Digital Cognitive Overload

1. THE CAUSE OF COGNITIVE BLINDNESS
We live in an age of severe intentional friction. Modern software architectures are deliberately designed to hijack human attention lines. Consumer applications have transformed from quiet tools into noisy, feature-bloated relational landfills filled with flashing dashboards, bright notification feeds, and complex folder structures that penalize the simple act of remembering.

2. THE PURITY OF ZERO-UI CAPTURE
Aether is an aesthetic and functional rebellion. We believe that your digital memory engine should feel like a quiet, tech-monastic sanctuary—not a chore. By utilizing an invisible, background-tier AI processing matrix, Aether removes the 'Capture Penalty' entirely. You drop an asset, paste a long link, or speak a passing thought, and our system silently indexes, classifies, and locks that context into place.

3. RETURNING TO IMMERSIVE FOCUS
Our design is a commitment to negative space, obsidian tones, and crisp monospace clarity. By keeping the visual container immaculate, we clear the mental noise, leaving you with nothing but a clean single-line input canvas. Don't arrange. Don't sort. Just write, capture, and let Aether hold the architecture of your thoughts.`

const CONTACT_TEXT = `Aether Sanctuary Core — Communications Gateway

For technical infrastructure inquiries, API connection discrepancies, system architecture evaluations, or account enterprise management, please utilize our formal contact channels.

System Administration: infrastructure@aether-sanctuary.app
Developer Relations: engineering@aether-sanctuary.app
General Operations Support: core@aether-sanctuary.app

Our serverless deployment frameworks and database layers are monitored continuously. For real-time updates regarding network status or operational integrity, please reference the main deployment matrix dashboards.`

const TITLES: Record<string, string> = {
  privacy: 'Privacy Charter',
  manifesto: 'The Manifesto',
  contact: 'Contact',
}

const TEXTS: Record<string, string> = {
  privacy: PRIVACY_TEXT,
  manifesto: MANIFESTO_TEXT,
  contact: CONTACT_TEXT,
}

export function LegalModal({ type, onClose }: { type: DocType; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!type) return
    const t = setTimeout(() => closeRef.current?.focus(), 30)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [type, onClose])

  if (!type) return null

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={TITLES[type]} className="fixed inset-0 z-[100] flex items-center justify-center p-5">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-md" />
      <div className="relative w-full max-w-lg max-h-[80vh] overflow-hidden rounded-[28px] border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#27272A]/80 dark:backdrop-blur-md shadow-[0_40px_120px_-20px_rgba(0,0,0,0.35)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200/50 dark:border-zinc-800/60 bg-white/90 dark:bg-[#27272A]/80 px-6 py-4 backdrop-blur-xl">
          <h2 className="font-display text-lg tracking-tight text-zinc-900 dark:text-zinc-50">{TITLES[type]}</h2>
          <button ref={closeRef} aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition-all duration-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-7 pb-7 pt-6 aether-scroll">
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 font-sans">
            {TEXTS[type]}
          </div>
        </div>
      </div>
    </div>, document.body)
}
