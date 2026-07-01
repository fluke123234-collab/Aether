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
  { user: '@dev_monk', text: 'Aether completely cured my tab anxiety. The autonomous organization is flawless.' },
  { user: '@system_builder', text: 'I threw 40 hardware spec screenshots at it and Ask Aether retrieved the exact CPU name in 400ms.' },
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
            <h2 className="mt-3 text-2xl sm:text-3xl font-medium tracking-tight text-white">
              Your Mind on Autopilot.
            </h2>
            <p className="mt-2 text-sm text-neutral-400">
              You dump the chaos. Aether distills the clarity.
            </p>
            <p className="mt-3 text-xs text-blue-400">
              Get started for just $7.99/month. Unlocked forever.
            </p>
          </div>

          {/* ── Three low-contrast pricing columns ── */}
          <div className="flex flex-col gap-8 md:flex-row">

            {/* ═══ Column 1: Mist — Free Baseline ═══ */}
            <div className="flex-1 rounded-3xl border border-neutral-800/70 bg-neutral-950/40 p-6">
              <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
                01 Mist
              </p>
              <p className="mt-3 text-3xl font-semibold text-neutral-300">
                Free
              </p>
              <p className="mt-1 text-xs text-neutral-600">The quiet foundation.</p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-neutral-500">
                <li>Unlimited Text Capture</li>
                <li>Standard Keyword Search</li>
                <li>6 Core Collections</li>
                <li>3 Free Premium Actions</li>
                <li>Full Sanctuary UI</li>
              </ul>
              <div className="mt-6 w-full rounded-xl border border-neutral-800 bg-neutral-900/40 py-2.5 text-center text-xs font-medium text-neutral-500">
                CURRENTLY ACTIVE
              </div>
            </div>

            {/* ═══ Column 2: Echo — Featured with blue glow ═══ */}
            <div className="relative flex flex-1 flex-col rounded-3xl border border-blue-500/30 bg-neutral-950/60 p-6 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
              <div className="pointer-events-none absolute -inset-1 rounded-[2rem] bg-blue-500/5 blur-xl" aria-hidden />
              <div className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-blue-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]">Most Popular</div>
              <div className="relative flex flex-1 flex-col">
                <p className="font-mono text-xs uppercase tracking-widest text-blue-400">02 Echo</p>
                <p className="mt-3 text-3xl font-semibold text-white">$7.99 <span className="text-sm font-normal text-neutral-400">/ mo</span></p>
                <p className="mt-1 text-xs text-blue-300/70">Unlock the full autonomous sanctuary. Perfect for effortless mental clarity.</p>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm text-neutral-300">
                  <li>Everything in Mist</li>
                  <li><span className="font-medium text-white">100</span> AI Captures / Month</li>
                  <li>Image OCR &amp; Voice Transcription</li>
                  <li>Web Summaries (auto-scrape + tags)</li>
                  <li>Basic Semantic Search</li>
                  <li>High-fidelity Waveform UI</li>
                  <li>Priority Support</li>
                </ul>
                <button onClick={() => handleSelect('Echo')} className="mt-6 w-full rounded-xl bg-blue-500 py-2.5 text-center text-xs font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] transition-all duration-500 hover:bg-blue-400 hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] hover:scale-[1.02]">ASCEND TO ECHO</button>
              </div>
            </div>

            {/* ═══ Column 3: Presence — Total Awareness ═══ */}
            <div className="flex flex-1 flex-col rounded-3xl border border-neutral-700/70 bg-neutral-950/50 p-6">
              <p className="font-mono text-xs uppercase tracking-widest text-neutral-300">03 Presence</p>
              <p className="mt-3 text-3xl font-semibold text-neutral-200">$11.99 <span className="text-sm font-normal text-neutral-500">/ mo</span></p>
              <p className="mt-1 text-xs text-neutral-500">Total, effortless recall. The perfect memory.</p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-neutral-400">
                <li>Everything in Echo</li>
                <li>Unlimited AI Captures</li>
                <li className="group/tooltip relative cursor-help">Full Spatial Memory
                  <span className="pointer-events-none absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 opacity-0 shadow-xl transition-opacity duration-300 group-hover/tooltip:opacity-100">Aether understands the layout and context of your screenshots, not just the text.</span>
                </li>
                <li>Deep Semantic Insight (chat with your entire memory)</li>
                <li>Weekly Micro-Recap Insights</li>
                <li>Priority Processing (zero-latency)</li>
              </ul>
              <button onClick={() => handleSelect('Presence')} className="mt-6 w-full rounded-xl border border-neutral-700 bg-transparent py-2.5 text-center text-xs font-medium text-white transition-all duration-500 hover:border-white hover:bg-neutral-900/40">UNLOCK PRESENCE</button>
              <p className="mt-3 text-center text-[10px] text-neutral-600">Fair use applies. See Terms of Service.</p>
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
