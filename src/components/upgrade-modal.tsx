'use client'

/**
 * Aether · UpgradeModal — The Monolith Portal
 * ------------------------------------------------------------
 * A hyper-premium visual gateway. Organic curved architecture
 * (rounded-[2.5rem]), soft ambient top glow, welcoming entry
 * typography, three low-contrast pricing columns with rounded
 * internal containers, and an infinite slow-scrolling horizontal
 * social-proof ticker underneath.
 *
 * Visual language: obsidian glass (#0A0A0A/90 + backdrop-blur-2xl),
 * monospace typography, deep fluid spacing, organic curves —
 * no rigid grid lines. Follows the createPortal + CSS-keyframe
 * pattern used by every other Aether modal.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

const reviews = [
  { user: '@dev_monk', text: 'Aether completely cured my tab anxiety. The link clamping is flawless.' },
  { user: '@system_builder', text: 'I threw 40 hardware spec screenshots at it and ⌘K retrieved the exact CPU name in 400ms.' },
  { user: '@minimalist_founder', text: 'The audio transcription accuracy is phenomenal. It captures everything I mutter on the move.' },
  { user: '@alpha_architect', text: 'Finally, a digital sanctuary that doesn\'t force me to manage database tags manually.' },
]

export function UpgradeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => closeRef.current?.focus(), 30)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
    }
  }, [open, onClose])

  const [isProcessing, setIsProcessing] = useState(false)

  if (!open) return null

  const handleSelect = (tier: string) => {
    // Rage-click protection: hard drop any rapid double-clicks
    if (isProcessing) return
    setIsProcessing(true)
    try {
      toast(`${tier} — coming soon.`, {
        description: 'Billing infrastructure arrives in a future build.',
      })
      onClose()
    } catch {
      toast.error('Sanctuary busy. One moment…')
    } finally {
      setIsProcessing(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upgrade your sanctuary"
      className="fixed inset-0 z-[100] flex items-center justify-center p-5"
    >
      {/* ── Atmosphere — blurred portal backdrop ── */}
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-xl"
      />

      {/* ── Framework — obsidian monolith portal ── */}
      <div className="relative mx-4 max-h-[90vh] w-full max-w-4xl animate-[aether-modal-in_220ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="relative max-h-[90vh] overflow-y-auto aether-scroll-dark rounded-[2.5rem] border border-neutral-950 bg-[#0A0A0A]/90 p-10 shadow-2xl backdrop-blur-2xl">

          {/* Ambient top glow — soft welcome layer */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-40 rounded-t-[2.5rem] bg-gradient-to-b from-neutral-900/40 to-transparent"
          />

          {/* Close anchor — top-right, low-contrast */}
          <button
            ref={closeRef}
            onClick={onClose}
            className="absolute right-8 top-6 z-10 font-mono text-[11px] text-neutral-600 transition-colors duration-300 hover:text-neutral-300"
          >
            ✕ Close
          </button>

          {/* ── Welcome Layer — centered greeting ── */}
          <div className="relative mb-10 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
              00 // THE PORTAL
            </p>
            <h2 className="mt-3 font-mono text-lg tracking-tight text-neutral-200">
              Welcome to your thoughts, unified.
            </h2>
            <p className="mt-2 font-mono text-xs text-neutral-600">
              Choose the depth of your sanctuary&apos;s memory.
            </p>
          </div>

          {/* ── Three low-contrast pricing columns ── */}
          <div className="flex flex-col gap-8 md:flex-row">

            {/* ═══ Column 1: Sanctuary — Current Baseline ═══ */}
            <div className="flex-1 rounded-3xl border border-neutral-900/80 bg-neutral-950/30 p-6">
              <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
                01 // Sanctuary
              </p>
              <p className="mt-3 font-mono text-2xl text-neutral-300">
                $0 <span className="text-sm text-neutral-600">/ Forever</span>
              </p>
              <span className="mb-4 mt-4 inline-block rounded-full border border-neutral-800 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
                [ CURRENT ]
              </span>
              <ul className="space-y-2.5 font-mono text-[13px] text-neutral-500">
                <li>Unlimited pure text fragments</li>
                <li>6 Strict auto-sorting folders</li>
                <li>Standard indexed text search</li>
              </ul>
            </div>

            {/* ═══ Column 2: Monolith — Daily Companion ═══ */}
            <div className="flex-1 rounded-3xl border border-neutral-800 bg-neutral-950/40 p-6">
              <p className="font-mono text-xs uppercase tracking-widest text-neutral-200">
                02 // Monolith
              </p>
              <p className="mt-3 font-mono text-2xl text-neutral-200">
                $5.99 <span className="text-sm text-neutral-500">/ Month</span>
              </p>
              <div className="mb-4 mt-4 h-[22px]" aria-hidden />
              <ul className="space-y-2.5 font-mono text-[13px] text-neutral-400">
                <li>50 Multi-asset AI captures / mo</li>
                <li>Native Voice-to-Text translation</li>
                <li>Deep Link extraction &amp; summaries</li>
                <li>Optical Snapshot OCR parsing</li>
              </ul>
              <button
                onClick={() => handleSelect('Monolith')}
                className="mt-5 w-full rounded-xl border border-neutral-700 bg-transparent py-2.5 font-mono text-xs text-white transition-all duration-500 hover:border-white hover:bg-neutral-900/40"
              >
                [ INITIALIZE MONOLITH ]
              </button>
            </div>

            {/* ═══ Column 3: Aether Pro — Full Spatial Memory ═══ */}
            <div className="relative flex-1 rounded-3xl border border-neutral-700 bg-neutral-950/60 p-6">
              {/* Glowing ambient focus halo */}
              <div className="pointer-events-none absolute -inset-2 rounded-[2rem] bg-white/[0.03] blur-2xl" aria-hidden />
              <div className="relative">
                <p className="font-mono text-xs uppercase tracking-widest text-white">
                  03 // Aether Pro
                </p>
                <p className="mt-3 font-mono text-2xl text-white">
                  $11.99 <span className="text-sm text-neutral-400">/ Month</span>
                </p>
                <div className="mb-4 mt-4 h-[22px]" aria-hidden />
                <ul className="space-y-2.5 font-mono text-[13px] text-neutral-400">
                  <li><span className="text-white">Unlimited everything</span> (No asset limits)</li>
                  <li><span className="text-white">Deep Semantic Memory</span> (&#8984;K connects thoughts across months)</li>
                  <li>Priority execution routing</li>
                  <li>Micro-insights recap generations</li>
                </ul>
                <button
                  onClick={() => handleSelect('Aether Pro')}
                  className="mt-5 w-full rounded-xl bg-white py-2.5 font-mono text-xs font-bold text-black transition-all duration-500 hover:bg-neutral-200 hover:scale-[1.02]"
                >
                  [ ASCEND TO PRO ]
                </button>
              </div>
            </div>

          </div>

          {/* ── Infinite Ambient Reviews Marquee ── */}
          <div className="relative mt-8 w-full overflow-hidden border-t border-neutral-950 pt-8 mask-gradient-x">
            <div className="flex w-max gap-6 animate-marquee whitespace-nowrap">
              {[...reviews, ...reviews].map((rev, idx) => (
                <div
                  key={idx}
                  className="inline-flex min-w-[300px] flex-col rounded-2xl border border-neutral-900 bg-[#050505] px-6 py-4"
                >
                  <span className="font-mono text-[13px] tracking-tight text-white">
                    &ldquo;{rev.text}&rdquo;
                  </span>
                  <span className="mt-2 font-mono text-[10px] tracking-wider text-neutral-600">
                    {rev.user} {'//'} Verified Architect
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      <style>{`@keyframes aether-modal-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>,
    document.body
  )
}
