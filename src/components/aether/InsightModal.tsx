'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, Loader2, Compass } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

type InsightData = { success: boolean; insight: string; angle: string; error?: string }

export function InsightModal({ open, memoryId, memoryTitle, onClose }: { open: boolean; memoryId: string | null; memoryTitle: string; onClose: () => void }) {
  const [data, setData] = useState<InsightData | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    if (!open || !memoryId) return
    const token = ++tokenRef.current
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (token !== tokenRef.current) return
      if (!session?.user) { toast.error('Please sign in to read insights.'); return }
      try {
        const res = await fetch('/api/insight', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ id: memoryId }) })
        if (token !== tokenRef.current) return
        const json = (await res.json()) as InsightData
        if (token !== tokenRef.current) return
        if (!res.ok || !json.success) { if (res.status === 401) toast.error('Your session has expired — please sign in again.'); return }
        setData(json)
      } catch { if (token !== tokenRef.current) return; toast.error('Could not generate an insight right now.') }
    }
    load()
    return () => { tokenRef.current++ }
  }, [open, memoryId])

  useEffect(() => {
    if (!open && data !== null) { const t = setTimeout(() => setData(null), 300); return () => clearTimeout(t) }
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
  const loading = open && data === null

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="AI insight" className="fixed inset-0 z-[100] flex items-center justify-center p-5">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-md" />
      <div className="relative w-full max-w-lg animate-[aether-modal-in_220ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="overflow-hidden rounded-[28px] border border-zinc-100 bg-white shadow-[0_40px_120px_-20px_rgba(0,0,0,0.35)]">
          <div className="relative h-20 bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600">
            <div className="absolute -bottom-8 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-white/20 blur-2xl" />
            <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-white"><Compass className="h-4 w-4" /><span className="font-display text-lg tracking-tight">A new angle</span></div>
            <button ref={closeRef} aria-label="Close" onClick={onClose} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-all duration-200 hover:bg-white/30 hover:scale-105 active:scale-95"><X className="h-4 w-4" /></button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-7 pb-7 pt-6 aether-scroll">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-purple-400" /><p className="mt-4 text-sm text-zinc-400">Finding a new angle…</p></div>
            ) : data ? (
              <>
                <p className="mb-4 text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">On: <span className="text-zinc-600">{memoryTitle}</span></p>
                <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-purple-400"><Sparkles className="h-3.5 w-3.5" />{data.angle}</div>
                <p className="font-display text-lg leading-relaxed tracking-tight text-zinc-800">{data.insight}</p>
              </>
            ) : <div className="py-10 text-center text-sm text-zinc-400">Could not load this insight.</div>}
          </div>
        </div>
      </div>
      <style>{`@keyframes aether-modal-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>, document.body)
}
