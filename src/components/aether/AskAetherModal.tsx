'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Sparkles, ArrowUp, Loader2, Feather } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import type { MemoryRow } from '@/lib/types'
import { formatDistanceToNow } from 'date-fns'

type Turn = { question: string; answer: string; memoryIds: string[] }
type AskResponse = { success: boolean; answer: string; memoryIds: string[]; error?: string }

export function AskAetherModal({ open, memories, onClose, onFocusMemory }: { open: boolean; memories: MemoryRow[]; onClose: () => void; onFocusMemory: (id: string) => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [turns, loading])

  useEffect(() => {
    if (!open && turns.length) { const t = setTimeout(() => setTurns([]), 300); return () => clearTimeout(t) }
  }, [open, turns])

  if (!open) return null

  const ask = async () => {
    const question = input.trim()
    if (!question || loading) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { toast.error('Please sign in to ask Aether.'); return }
    setInput(''); setLoading(true)
    const token = ++tokenRef.current
    const history = turns.flatMap((t) => [{ role: 'user' as const, text: t.question }, { role: 'model' as const, text: t.answer }])
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ question, history }) })
      if (token !== tokenRef.current) return
      const json = (await res.json()) as AskResponse
      if (token !== tokenRef.current) return
      if (!res.ok || !json.success) { if (res.status === 401) toast.error('Your session has expired — please sign in again.'); else toast.error('Aether could not answer right now.'); setLoading(false); return }
      setTurns((prev) => [...prev, { question, answer: json.answer, memoryIds: json.memoryIds }]); setLoading(false)
    } catch { if (token !== tokenRef.current) return; toast.error('Aether is not reachable right now.'); setLoading(false) }
  }

  const memoryById = (id: string) => memories.find((m) => m.id === id)

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Ask Aether" className="fixed inset-0 z-[100] flex items-center justify-center p-5">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-md" />
      <div className="relative flex h-[80vh] max-h-[640px] w-full max-w-2xl animate-[aether-modal-in_220ms_cubic-bezier(0.16,1,0.3,1)] flex-col overflow-hidden rounded-[28px] border border-zinc-100 bg-white shadow-[0_40px_120px_-20px_rgba(0,0,0,0.35)]">
        <div className="relative h-16 shrink-0 bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600">
          <div className="absolute -bottom-6 left-1/2 h-20 w-20 -translate-x-1/2 rounded-full bg-white/20 blur-2xl" />
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-white"><Search className="h-4 w-4" /><span className="font-display text-lg tracking-tight">Ask Aether</span></div>
          <button aria-label="Close" onClick={onClose} className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-all duration-200 hover:bg-white/30 hover:scale-105 active:scale-95"><X className="h-4 w-4" /></button>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 aether-scroll">
          {turns.length === 0 && !loading ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-purple-50 text-purple-400"><Sparkles className="h-6 w-6" /></div>
              <p className="font-display text-xl tracking-tight text-zinc-800">Ask about your thoughts.</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">Aether will search your sanctuary, connect the threads, and talk back — citing the memories it found.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {['What have I been thinking about lately?', 'Help me work through an idea', 'What patterns do you notice in my thoughts?'].map((s) => (
                  <button key={s} onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 0) }} className="rounded-full border border-zinc-100 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-600 transition-all duration-300 hover:border-zinc-200 hover:bg-zinc-50 active:scale-95">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {turns.map((turn, i) => (
                <div key={i} className="space-y-3">
                  <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-sm text-white">{turn.question}</div></div>
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-50 text-purple-400"><Feather className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-relaxed text-zinc-700 whitespace-pre-line">{turn.answer}</p>
                      {turn.memoryIds.length > 0 && (
                        <div className="mt-3">
                          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">Linked from your sanctuary</p>
                          <div className="flex flex-col gap-2">
                            {turn.memoryIds.map((id) => { const m = memoryById(id); if (!m) return null; return (
                              <button key={id} onClick={() => { onFocusMemory(id); onClose() }} className="group flex items-center gap-3 rounded-xl border border-zinc-100 bg-white px-3 py-2 text-left transition-all duration-300 hover:border-purple-200 hover:bg-purple-50/40 active:scale-[0.98]">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-50 text-zinc-400 group-hover:bg-purple-100 group-hover:text-purple-500"><Sparkles className="h-3.5 w-3.5" /></div>
                                <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-800">{m.title}</p><p className="truncate text-[11px] text-zinc-400">{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</p></div>
                              </button>) })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (<div className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-50 text-purple-400"><Loader2 className="h-4 w-4 animate-spin" /></div><p className="text-sm text-zinc-400">Searching your sanctuary…</p></div>)}
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-zinc-100 p-3">
          <div className="flex items-center gap-1 rounded-full border border-zinc-100 bg-white p-1.5 pl-5 shadow-[0_4px_20px_0_rgba(0,0,0,0.02)] transition-all duration-300 focus-within:border-zinc-200">
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }} placeholder="Ask about your thoughts…" className="h-11 flex-1 bg-transparent text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-0" />
            <button aria-label="Ask" onClick={ask} disabled={!input.trim() || loading} className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white transition-all duration-300 hover:bg-purple-600 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:bg-zinc-900 disabled:hover:scale-100"><ArrowUp className="h-[18px] w-[18px]" /></button>
          </div>
        </div>
      </div>
      <style>{`@keyframes aether-modal-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>, document.body)
}
