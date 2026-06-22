'use client'

import { useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Sparkles } from 'lucide-react'
import type { MemoryRow } from '@/lib/types'

export function Serendipity({ memories }: { memories: MemoryRow[] }) {
  const memory = useMemo(() => {
    if (memories.length === 0) return null
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000
    const past = memories.filter((m) => !m.id.startsWith('temp-') && new Date(m.created_at).getTime() < cutoff)
    if (past.length === 0) return null
    const dayOfYear = Math.floor(Date.now() / (1000 * 60 * 60 * 24))
    return past[dayOfYear % past.length]
  }, [memories])

  if (!memory) return null

  return (
    <section className="mx-auto w-full max-w-3xl px-5">
      <div className="relative overflow-hidden rounded-2xl border border-zinc-100 dark:border-zinc-800/60 bg-white/60 p-6 backdrop-blur-sm shadow-[0_4px_20px_0_rgba(0,0,0,0.015)]">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-purple-100/30 blur-2xl" />
        <div className="relative flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-50 text-purple-400"><Sparkles className="h-[18px] w-[18px]" /></div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">From your sanctuary · {formatDistanceToNow(new Date(memory.created_at), { addSuffix: true })}</p>
            <h4 className="mb-1.5 text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{memory.title}</h4>
            <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-500 line-clamp-3">{memory.body}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
