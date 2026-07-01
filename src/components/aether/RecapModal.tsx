'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, Loader2, Sunrise, Lightbulb, Share2, Lock, Target, AlertCircle, Zap, Check } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

type RecapData = {
  success: boolean
  stats: { total: number; captured: number; recalled: number }
  distillation: string
  insights: string[]
  quiet?: boolean
  sparse?: boolean
  locked?: boolean
  tier?: string
  error?: string
}

export function RecapModal({ open, onClose, onUpgrade }: { open: boolean; onClose: () => void; onUpgrade?: () => void }) {
  const [data, setData] = useState<RecapData | null>(null)
  const [recapStage, setRecapStage] = useState<'idle' | 'scanning' | 'connecting' | 'complete'>('idle')
  const [checkedDebts, setCheckedDebts] = useState<Set<number>>(new Set())
  const closeRef = useRef<HTMLButtonElement>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const token = ++tokenRef.current

    const load = async () => {
      // Stage 1: scanning
      setRecapStage('scanning')
      await new Promise(r => setTimeout(r, 800))

      // Stage 2: connecting
      if (token !== tokenRef.current) return
      setRecapStage('connecting')

      const { data: { session } } = await supabase.auth.getSession()
      if (token !== tokenRef.current) return
      if (!session?.user) { toast.error('Please sign in to read your recap.'); setRecapStage('idle'); return }
      try {
        const res = await fetch('/api/recap', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
        if (token !== tokenRef.current) return
        const json = (await res.json()) as RecapData
        if (token !== tokenRef.current) return
        if (!res.ok || !json.success) { if (res.status === 401) toast.error('Your session has expired — please sign in again.'); setRecapStage('idle'); return }

        // Stage 3: complete
        setRecapStage('complete')
        setData(json)
      } catch {
        if (token !== tokenRef.current) return
        setRecapStage('idle')
        toast.error('Could not generate your recap right now.')
      }
    }
    load()
    return () => { tokenRef.current++ }
  }, [open])

  useEffect(() => {
    if (!open && data !== null) { const t = setTimeout(() => { setData(null); setRecapStage('idle'); setCheckedDebts(new Set()) }, 300); return () => clearTimeout(t) }
  }, [open, data])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => closeRef.current?.focus(), 30)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [open, onClose])

  if (!open) return null

  const loading = recapStage !== 'complete' || data === null

  const handleShare = () => {
    if (!data) return
    const text = `My Aether Mind Engine Recap:\n\n${data.distillation}\n\n${data.insights.map(s => `• ${s}`).join('\n')}\n\n— via Aether`
    if (navigator.share) { navigator.share({ title: 'My Aether Recap', text }).catch(() => {}) }
    else { navigator.clipboard.writeText(text); toast.success('Recap copied to clipboard.') }
  }

  // Parse insights into radar/debt/catalyst blocks
  const radarItems = data?.insights.filter(s => s.startsWith('🎯') || s.startsWith('Harsh truth')) || []
  const debtItems = data?.insights.filter(s => s.startsWith('🚨')) || []
  const catalystItem = data?.insights.find(s => s.startsWith('⚡')) || ''

  const toggleDebt = (idx: number) => {
    setCheckedDebts(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n })
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Your 24h recap" className="fixed inset-0 z-[100] flex items-center justify-center p-5">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-md" />
      <div className="relative w-full max-w-lg animate-[aether-modal-in_220ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="overflow-hidden rounded-[28px] border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#27272A]/80 dark:backdrop-blur-md shadow-[0_40px_120px_-20px_rgba(0,0,0,0.35)]">
          {/* Header */}
          <div className="relative h-20 bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600">
            <div className="absolute -bottom-8 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-white/20 blur-2xl" />
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-white">
              <Sunrise className="h-4 w-4" /><span className="font-display text-lg tracking-tight">Mind Engine</span>
            </div>
            {data && !loading && !data.quiet && (
              <div className="absolute right-14 top-4">
                <button onClick={handleShare} aria-label="Share recap" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-all duration-200 hover:bg-white/30 hover:scale-105 active:scale-95">
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            )}
            <button ref={closeRef} aria-label="Close" onClick={onClose} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-all duration-200 hover:bg-white/30 hover:scale-105 active:scale-95"><X className="h-4 w-4" /></button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto px-7 pb-7 pt-6 aether-scroll">
            {/* Multi-stage loading animation */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <div className="relative h-12 w-12">
                  <div className={`absolute inset-0 rounded-full border-2 transition-all duration-500 ${recapStage === 'scanning' ? 'border-purple-500 animate-spin' : 'border-zinc-200 dark:border-zinc-700'}`} />
                  <div className={`absolute inset-0 rounded-full border-2 border-t-transparent transition-all duration-500 ${recapStage === 'connecting' ? 'border-blue-500 animate-spin' : 'border-transparent'}`} />
                  {recapStage === 'complete' && <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-purple-500" />}
                </div>
                <div className="text-center">
                  {recapStage === 'scanning' && <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 animate-pulse">Scanning 24h neural dump…</p>}
                  {recapStage === 'connecting' && <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 animate-pulse">Synthesizing cross-note dependencies…</p>}
                  {recapStage === 'complete' && <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Compiling your mind mirror…</p>}
                </div>
                {/* Progress dots */}
                <div className="flex gap-1.5">
                  <div className={`h-1.5 rounded-full transition-all duration-500 ${recapStage !== 'idle' ? 'w-6 bg-purple-500' : 'w-1.5 bg-zinc-200 dark:bg-zinc-700'}`} />
                  <div className={`h-1.5 rounded-full transition-all duration-500 ${(recapStage === 'connecting' || recapStage === 'complete') ? 'w-6 bg-blue-500' : 'w-1.5 bg-zinc-200 dark:bg-zinc-700'}`} />
                  <div className={`h-1.5 rounded-full transition-all duration-500 ${recapStage === 'complete' ? 'w-6 bg-emerald-500' : 'w-1.5 bg-zinc-200 dark:bg-zinc-700'}`} />
                </div>
              </div>
            ) : data ? (
              <>
                {/* Status badges */}
                {data.quiet && <div className="mb-4 flex items-center gap-2 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"><Sparkles className="h-3.5 w-3.5 text-zinc-400" />No thoughts captured in the last 24 hours.</div>}
                {data.sparse && <div className="mb-4 flex items-center gap-2 rounded-2xl bg-purple-50 dark:bg-purple-500/10 px-4 py-2.5 text-xs font-medium text-purple-600 dark:text-purple-300"><Lightbulb className="h-3.5 w-3.5" />A quiet day — here is a prompt to reflect on.</div>}

                {/* Stats row */}
                <div className="mb-6 flex gap-6">
                  <div><div className="font-display text-2xl leading-none text-zinc-900 dark:text-zinc-50">{data.stats.captured}</div><div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">today</div></div>
                  <div><div className="font-display text-2xl leading-none text-zinc-900 dark:text-zinc-50">{data.stats.total}</div><div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">kept</div></div>
                  <div><div className="font-display text-2xl leading-none text-zinc-900 dark:text-zinc-50">{data.stats.recalled}</div><div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">recalled</div></div>
                </div>

                {/* THE RADAR — emerald glow card */}
                {radarItems.length > 0 && (
                  <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/5 p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      <Target className="h-4 w-4" /> The Radar
                    </div>
                    {radarItems.map((item, i) => (
                      <p key={i} className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200 mb-1">
                        {item.replace(/^[🎯🚨⚡]\s*/, '').replace(/^Harsh truth:\s*/, '')}
                      </p>
                    ))}
                  </div>
                )}

                {/* THE DEBT — interactive checklist */}
                {debtItems.length > 0 && (
                  <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-50/30 dark:bg-amber-500/5 p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      <AlertCircle className="h-4 w-4" /> The Mental Debt
                    </div>
                    <div className="space-y-2">
                      {debtItems.map((item, i) => (
                        <button
                          key={i}
                          onClick={() => toggleDebt(i)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-all hover:bg-amber-50 dark:hover:bg-amber-500/10"
                        >
                          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${checkedDebts.has(i) ? 'border-amber-500 bg-amber-500' : 'border-amber-300 dark:border-amber-600'}`}>
                            {checkedDebts.has(i) && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className={`text-sm leading-relaxed transition-all ${checkedDebts.has(i) ? 'text-zinc-400 line-through dark:text-zinc-600' : 'text-zinc-700 dark:text-zinc-200'}`}>
                            {item.replace(/^🚨\s*/, '')}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* THE CATALYST — obsidian card with pulsing violet */}
                {catalystItem && (
                  <div className="mb-4 rounded-2xl border border-purple-500/20 bg-zinc-900 dark:bg-black/40 p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-purple-400">
                      <Zap className="h-4 w-4" /> The Morning Catalyst
                    </div>
                    <p className="text-sm leading-relaxed text-purple-100 font-medium">
                      {catalystItem.replace(/^⚡\s*/, '')}
                      <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-purple-400" />
                    </p>
                  </div>
                )}

                {/* Fallback: if no structured blocks, show distillation + insights normally */}
                {radarItems.length === 0 && debtItems.length === 0 && !catalystItem && (
                  <>
                    <div className="mb-6">
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-purple-400"><Sparkles className="h-3.5 w-3.5" />Distillation</div>
                      <p className="font-display text-lg leading-relaxed tracking-tight text-zinc-800 dark:text-zinc-200">{data.distillation}</p>
                    </div>
                    {data.insights.length > 0 && (
                      <div>
                        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500"><Lightbulb className="h-3.5 w-3.5" />Insights</div>
                        <ul className="space-y-2.5">
                          {data.insights.map((insight, i) => (
                            <li key={i} className="flex gap-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
                              <span className="mt-0.5 font-display text-purple-400">{i + 1}</span><span>{insight}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : <div className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">Could not load your recap.</div>}
          </div>
        </div>
      </div>
      <style>{`@keyframes aether-modal-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>, document.body)
}
