'use client'

/**
 * Aether · Serendipity → "Resonance Anchor"
 * ------------------------------------------------------------
 * Dynamically surfaces a memory based on interaction resonance
 * rather than a random math function.
 *
 * Selection priority:
 *  1. Highest view_count (most-cited memory) → "A thought that keeps returning"
 *  2. If no memories have views, surface the oldest forgotten memory
 *     (>7 days old, not recently viewed) → "Surfacing from your deep archive"
 *  3. Fallback: deterministic day-of-year rotation
 *
 * The sub-label changes dynamically based on WHY the memory was chosen.
 */
import { useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Sparkles } from 'lucide-react'
import type { MemoryRow } from '@/lib/types'

type AnchorReason = 'resonance' | 'deep_archive' | 'rotation'

export function Serendipity({ memories }: { memories: MemoryRow[] }) {
  const { memory, reason } = useMemo(() => {
    if (memories.length === 0) return { memory: null, reason: 'rotation' as AnchorReason }

    // Only consider real (non-temp) memories older than 3 days.
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000
    const past = memories.filter(
      (m) => !m.id.startsWith('temp-') && new Date(m.created_at).getTime() < cutoff
    )
    if (past.length === 0) return { memory: null, reason: 'rotation' as AnchorReason }

    // ── Priority 1: highest resonance score (view_count) ──
    const withViews = past.filter((m) => (m.view_count ?? 0) > 0)
    if (withViews.length > 0) {
      const top = withViews.reduce((best, m) =>
        (m.view_count ?? 0) > (best.view_count ?? 0) ? m : best
      )
      return { memory: top, reason: 'resonance' as AnchorReason }
    }

    // ── Priority 2: oldest forgotten memory (>7 days, not recently viewed) ──
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const deepArchive = past
      .filter((m) => new Date(m.created_at).getTime() < sevenDaysAgo)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    if (deepArchive.length > 0) {
      return { memory: deepArchive[0], reason: 'deep_archive' as AnchorReason }
    }

    // ── Priority 3: deterministic day-of-year rotation (fallback) ──
    const dayOfYear = Math.floor(Date.now() / (1000 * 60 * 60 * 24))
    return { memory: past[dayOfYear % past.length], reason: 'rotation' as AnchorReason }
  }, [memories])

  // Dynamic sub-label based on WHY this memory was surfaced
  const subLabel = useMemo(() => {
    switch (reason) {
      case 'resonance':
        return 'A thought that keeps returning'
      case 'deep_archive':
        return 'Surfacing from your deep archive'
      case 'rotation':
      default:
        return `From your sanctuary · ${memory ? formatDistanceToNow(new Date(memory.created_at), { addSuffix: true }) : ''}`
    }
  }, [reason, memory])

  if (!memory) return null

  return (
    <section className="mx-auto w-full max-w-3xl px-5">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200/50 dark:border-zinc-800/60 bg-white/60 dark:bg-[#18181B]/80 p-6 backdrop-blur-sm shadow-[0_8px_30px_rgb(0,0,0,0.015)] dark:shadow-none">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-purple-100/30 dark:bg-purple-500/10 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-50 dark:bg-purple-500/10 text-purple-400 dark:text-purple-400">
            <Sparkles className="h-[18px] w-[18px]" />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">{subLabel}</p>
            <h4 className="mb-1.5 text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{memory.title}</h4>
            <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400 line-clamp-3">{memory.body}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
