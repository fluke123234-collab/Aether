'use client'

/**
 * Aether · InstantPaywall — hardware-accelerated luxury upgrade overlay
 * ------------------------------------------------------------
 * Renders instantly with CSS transitions (no React state delay).
 * Purple glow, glassmorphic obsidian card, smooth scale-up.
 */

import { createPortal } from 'react-dom'
import { X, Zap, Check } from 'lucide-react'

export function InstantPaywall({ isOpen, onClose, onUpgrade }: { isOpen: boolean; onClose: () => void; onUpgrade: () => void }) {
  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md"
      style={{ animation: 'aether-paywall-fade 150ms ease-out' }}
    >
      <div
        className="relative mx-4 w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl"
        style={{ animation: 'aether-paywall-scale 200ms cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* Glow */}
        <div className="pointer-events-none absolute -top-12 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-purple-500/10 blur-3xl" />

        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-neutral-600 transition-colors hover:text-neutral-300"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Icon */}
        <div className="mb-4 flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/10 border border-purple-500/20">
            <Zap className="h-6 w-6 text-purple-400" />
          </div>
        </div>

        <h3 className="text-center text-xl font-bold tracking-tight text-neutral-100">
          Deep Synthesis Unlocked
        </h3>
        <p className="mt-2 text-center text-sm leading-relaxed text-neutral-400">
          You've used your 3 free autonomous ingestion credits. Unlock unlimited cross-note connections and daily recaps for your mind.
        </p>

        {/* Features list */}
        <div className="mt-5 space-y-2">
          {['Unlimited AI captures', 'Image OCR & voice transcription', 'Daily Mind Engine recap', 'Semantic search across all notes'].map((feat) => (
            <div key={feat} className="flex items-center gap-2.5 text-sm text-neutral-300">
              <Check className="h-4 w-4 shrink-0 text-purple-400" />
              {feat}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => { onUpgrade(); onClose() }}
            className="w-full rounded-xl bg-white py-3 px-4 text-sm font-semibold text-black shadow-lg transition-all duration-200 hover:bg-neutral-200 active:scale-95"
          >
            Upgrade to Echo — $7.99/mo
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-400"
          >
            Maybe later
          </button>
        </div>
      </div>

      <style>{`
        @keyframes aether-paywall-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes aether-paywall-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>,
    document.body
  )
}
