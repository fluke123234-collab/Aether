'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, Loader2, Sunrise, Lightbulb } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

type RecapData = {
  success: boolean
  stats: { total: number; captured: number; recalled: number }
  distillation: string
  insights: string[]
  quiet?: boolean
  error?: string
}

export function RecapModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<RecapData | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const token = ++tokenRef.current

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (token !== tokenRef.current) return
      if (!session?.user) { toast.error('Please sign in to read your recap.'); return }
      try {
        const res = await fetch('/api/recap', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
        if (token !== tokenRef.current) return
        const json = (await res.json()) as RecapData
        if (token !== tokenRef.current) return
        if (!res.ok || !json.success) {
          if (res.status === 401) toast.error('Your session has expired — please sign in again.')
          return
        }
        setData(json)
      } catch {
        if (token !== tokenRef.current) return
        toast.error('Could not generate your recap right now.')
      }
    }
    load()
    return () => { tokenRef.current++ }
  }, [open])

  useEffect(() => {
    if (!open && data !== null) {
      const t = setTimeout(() => setData(null), 300)
      return () => clearTimeout(t)
    }
  }, [open, data])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => closeRef.current?.focus(), 30)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [open, onClose])

  if (!open) return null
  const loading = open && data === null

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Your 24h recap" className="fixed inset-0 z-[100] flex items-center justify-center p-5">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-md" />
      <div className="relative w-full max-w-lg animate-[aether-modal-in_220ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="overflow-hidden rounded-[28px] border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-[#18181B] dark:bg-[#27272A]/90 dark:border dark:border-zinc-700/50 dark:backdrop-blur-md shadow-[0_40px_120px_-20px_rgba(0,0,0,0.35)]">
          <div className="relative h-20 bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600">
            <div className="absolute -bottom-8 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-white/20 blur-2xl" />
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-white">
              <Sunrise className="h-4 w-4" /><span className="font-display text-lg tracking-tight">Your day, distilled</span>
            </div>
            <button ref={closeRef} aria-label="Close" onClick={onClose} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-all duration-200 hover:bg-white/30 hover:scale-105 active:scale-95"><X className="h-4 w-4" /></button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-7 pb-7 pt-6 aether-scroll">
            {loading ? (
              <div className="space-y-5">
                <div className="flex gap-6"><div className="h-8 w-10 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" /><div className="h-8 w-10 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" /><div className="h-8 w-10 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" /></div>
                <div className="space-y-2"><div className="h-3 w-24 animate-pulse rounded-full bg-purple-100" /><div className="h-4 w-full animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" /><div className="h-4 w-5/6 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" /></div>
              </div>
            ) : data ? (
              <>
                {data.quiet && <div className="mb-4 flex items-center gap-2 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-500"><Sparkles className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />No thoughts captured in the last 24 hours.</div>}
                <div className="mb-6 flex gap-6">
                  <div><div className="font-display text-2xl leading-none text-zinc-900 dark:text-zinc-50">{data.stats.captured}</div><div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">today</div></div>
                  <div><div className="font-display text-2xl leading-none text-zinc-900 dark:text-zinc-50">{data.stats.total}</div><div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">kept</div></div>
                  <div><div className="font-display text-2xl leading-none text-zinc-900 dark:text-zinc-50">{data.stats.recalled}</div><div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">recalled</div></div>
                </div>
                <div className="mb-6">
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-purple-400"><Sparkles className="h-3.5 w-3.5" />Distillation</div>
                  <p className="font-display text-lg leading-relaxed tracking-tight text-zinc-800 dark:text-zinc-200">{data.distillation}</p>
                </div>
                <div>
                  <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500"><Lightbulb className="h-3.5 w-3.5" />Quiet insights</div>
                  <ul className="space-y-2.5">
                    {data.insights.map((insight, i) => (
                      <li key={i} className="flex gap-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50/60 px-4 py-2.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                        <span className="mt-0.5 font-display text-purple-400">{i + 1}</span><span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : <div className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">Could not load your recap.</div>}
          </div>
        </div>
      </div>
      <style>{`@keyframes aether-modal-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>, document.body)
}
