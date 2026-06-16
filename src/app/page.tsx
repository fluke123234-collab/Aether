'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { toast, Toaster as SonnerToaster } from 'sonner'
import {
  Search,
  Image as ImageIcon,
  Mic,
  Link2,
  ArrowUp,
  Sparkles,
  Clock,
  Lightbulb,
  BookOpen,
  Compass,
  Feather,
  Palette,
  Coffee,
  ArrowRight,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

/* ──────────────────────────────────────────────────────────────
   Types & helpers — live data layer (no more static mocks)
   ────────────────────────────────────────────────────────────── */

type MemoryRow = {
  id: string
  title: string
  body: string
  category: string | null
  tags: string[] | null
  created_at: string
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

/* Static icon renderer — keeps component references stable for the compiler. */
function CategoryIcon({
  category,
  className,
}: {
  category: string | null
  className?: string
}) {
  switch (category) {
    case 'idea':
      return <Lightbulb className={className} />
    case 'reading':
      return <BookOpen className={className} />
    case 'strategy':
      return <Compass className={className} />
    case 'quote':
      return <Feather className={className} />
    case 'design':
      return <Palette className={className} />
    case 'ritual':
      return <Coffee className={className} />
    default:
      return <Sparkles className={className} />
  }
}

/* The recap block keeps its own display config (out of Phase 2 scope). */
const recapStats = [
  { label: 'captured', value: '12' },
  { label: 'refined', value: '4' },
  { label: 'recalled', value: '27' },
]

/* ──────────────────────────────────────────────────────────────
   The Signature Glow — fixed, behind everything, breathing.
   ────────────────────────────────────────────────────────────── */

function TheGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* primary purple bloom — the breathing heart of the sanctuary */}
      <div className="absolute left-1/2 top-[12%] h-[780px] w-[780px] -translate-x-1/2 rounded-full bg-gradient-to-br from-purple-400/45 via-indigo-400/20 to-transparent blur-[120px] animate-breathe" />
      {/* secondary, offset, slower feel via delayed twin */}
      <div className="absolute right-[8%] top-[40%] h-[520px] w-[520px] rounded-full bg-gradient-to-tr from-fuchsia-300/20 via-purple-300/10 to-transparent blur-[120px] animate-breathe [animation-delay:-3s]" />
      {/* tertiary whisper on the left */}
      <div className="absolute left-[6%] top-[52%] h-[420px] w-[420px] rounded-full bg-gradient-to-tr from-indigo-300/15 via-purple-200/8 to-transparent blur-[120px] animate-breathe [animation-delay:-5s]" />
      {/* faint warm floor wash */}
      <div className="absolute bottom-0 left-0 h-[300px] w-full bg-gradient-to-t from-purple-100/30 to-transparent blur-[80px]" />
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Minimalist Top Rail
   ────────────────────────────────────────────────────────────── */

function TopRail() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#FAFAFA]/70 border-b border-zinc-100/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
        {/* Wordmark */}
        <a
          href="#"
          className="font-display text-2xl tracking-tight text-zinc-900 leading-none select-none"
        >
          Aether
        </a>

        {/* Omnipresent search */}
        <div className="ml-2 hidden flex-1 sm:block">
          <label className="group relative flex items-center">
            <Search className="pointer-events-none absolute left-4 h-4 w-4 text-zinc-400 transition-colors duration-300 group-focus-within:text-purple-500" />
            <input
              type="text"
              placeholder="Search the sanctuary…"
              className="h-10 w-full max-w-md rounded-full bg-white border border-zinc-100 pl-11 pr-16 text-sm text-zinc-700 placeholder:text-zinc-400 shadow-[inset_0_1px_2px_rgb(0,0,0,0.03)] focus:ring-0 focus:outline-none focus:border-zinc-200 transition-all duration-300"
            />
            <kbd className="absolute right-3 hidden md:flex items-center gap-1 rounded-md border border-zinc-100 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
              ⌘K
            </kbd>
          </label>
        </div>

        {/* Spacer for mobile where search hides */}
        <div className="flex-1 sm:hidden" />

        {/* Sign in pill */}
        <button className="shrink-0 rounded-full border border-transparent bg-zinc-900/0 px-5 py-2 text-sm font-medium text-zinc-600 transition-all duration-300 hover:bg-zinc-900 hover:text-white hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
          Sign in
        </button>
      </div>
    </header>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Focus Capture Capsule — now writes to Supabase
   ────────────────────────────────────────────────────────────── */

function FocusCapsule({
  onCapture,
}: {
  onCapture: (text: string) => Promise<boolean>
}) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const text = value.trim()
    if (!text || submitting) return
    setSubmitting(true)
    const ok = await onCapture(text)
    setSubmitting(false)
    if (ok) setValue('')
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-5 text-center">
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-100 bg-white/60 px-4 py-1.5 text-xs font-medium text-zinc-500 backdrop-blur-sm animate-rise">
        <Sparkles className="h-3.5 w-3.5 text-purple-400" />
        A quieter place to think
      </p>

      <h1 className="font-display text-5xl sm:text-6xl leading-[1.05] tracking-tight text-zinc-900 mb-4 animate-rise [animation-delay:60ms]">
        What is on your mind
        <br className="hidden sm:block" />
        <span className="italic text-purple-400/80"> today?</span>
      </h1>

      <p className="mx-auto mb-10 max-w-md text-[15px] leading-relaxed text-zinc-500 animate-rise [animation-delay:120ms]">
        Capture a thought, ask a question, or let Aether recall what mattered.
        Nothing here rushes you.
      </p>

      {/* The Capsule */}
      <div className="animate-rise [animation-delay:180ms]">
        <div className="group relative flex items-center gap-1 rounded-full border border-zinc-100 bg-white p-1.5 pl-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] transition-all duration-500 focus-within:shadow-[0_12px_50px_rgb(139,92,246,0.08)] focus-within:border-zinc-200/80">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="Capture a thought, or ask Aether…"
            className="h-12 flex-1 bg-transparent text-[15px] text-zinc-800 placeholder:text-zinc-500 focus:outline-none focus:ring-0"
          />

          {/* Micro-action triggers */}
          <div className="flex items-center gap-0.5">
            <CapsuleAction icon={ImageIcon} label="Attach image" />
            <CapsuleAction icon={Link2} label="Attach link" />
            <CapsuleAction icon={Mic} label="Voice capture" />

            {/* Send */}
            <button
              aria-label="Capture thought"
              onClick={handleSubmit}
              disabled={!value.trim() || submitting}
              className="ml-1 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 text-white transition-all duration-300 hover:bg-purple-600 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:bg-zinc-900 disabled:hover:scale-100"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowUp className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* silent hint row */}
        <div className="mt-4 flex items-center justify-center gap-5 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded border border-zinc-100 bg-white px-1.5 py-0.5 text-[10px] text-zinc-500">Enter</kbd>
            to capture
          </span>
          <span className="h-3 w-px bg-zinc-200" />
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-purple-400" />
            Aether organizes it for you
          </span>
        </div>
      </div>
    </section>
  )
}

function CapsuleAction({
  icon: Icon,
  label,
}: {
  icon: LucideIcon
  label: string
}) {
  return (
    <button
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-all duration-300 ease-out hover:bg-purple-50/80 hover:text-purple-600 scale-100 hover:scale-105 active:scale-95"
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Executive 24h Recap Block
   ────────────────────────────────────────────────────────────── */

function RecapBlock() {
  return (
    <section className="mx-auto w-full max-w-5xl px-5 animate-rise [animation-delay:240ms]">
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 p-8 sm:p-12 shadow-[0_30px_80px_-20px_rgba(139,92,246,0.45)]">
        {/* velvet sheen */}
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-10 h-72 w-72 rounded-full bg-indigo-300/20 blur-3xl" />

        <div className="relative">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium text-purple-50 backdrop-blur-sm">
            <Clock className="h-3.5 w-3.5" />
            24h Recap
          </div>

          <h2 className="font-display text-3xl sm:text-[40px] tracking-tight leading-relaxed font-medium text-white max-w-2xl">
            Your day, distilled into three quiet insights — the rest can wait until you ask.
          </h2>

          <div className="mt-9 flex flex-wrap items-end gap-8">
            {recapStats.map((s) => (
              <div key={s.label}>
                <div className="font-display text-4xl text-white leading-none">
                  {s.value}
                </div>
                <div className="mt-1.5 text-xs uppercase tracking-[0.18em] text-purple-200/80">
                  {s.label}
                </div>
              </div>
            ))}
            <button className="group ml-auto inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-all duration-300 hover:bg-white hover:text-purple-700">
              Read the recap
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Saner-Style Memory Feed — now reads live from Supabase
   ────────────────────────────────────────────────────────────── */

function MemoryFeed({
  memories,
  loading,
}: {
  memories: MemoryRow[]
  loading: boolean
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-5">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h3 className="font-display text-2xl tracking-tight text-zinc-900">
            Recent memories
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            A gentle stream of what you’ve kept.
          </p>
        </div>
        <button className="group inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors duration-300 hover:text-zinc-900">
          View all
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </button>
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : memories.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {memories.map((m) => (
            <MemoryCard key={m.id} memory={m} />
          ))}
        </div>
      )}
    </section>
  )
}

function MemoryCard({ memory }: { memory: MemoryRow }) {
  const pills = memory.tags ?? []
  return (
    <article className="group rounded-2xl border border-zinc-100/60 bg-white p-6 shadow-sm transition-all duration-500 hover:shadow-[0_10px_40px_rgba(0,0,0,0.03)] hover:-translate-y-0.5 hover:border-zinc-200/60">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-50 text-zinc-400 transition-all duration-300 group-hover:bg-purple-50 group-hover:text-purple-500">
          <CategoryIcon category={memory.category} className="h-5 w-5" />
        </div>
        <span className="text-xs text-zinc-400">{timeAgo(memory.created_at)}</span>
      </div>

      <h4 className="mb-2 text-[15px] font-semibold tracking-tight text-zinc-900">
        {memory.title}
      </h4>
      <p className="mb-5 text-sm leading-relaxed text-zinc-500">
        {memory.body}
      </p>

      {pills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pills.map((p) => (
            <span
              key={p}
              className="text-xs bg-purple-50 text-purple-600 font-medium px-3 py-1 rounded-full"
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

/* Premium loading skeletons — quiet pulse, never blocks render */
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-zinc-100/60 bg-white p-6 shadow-sm"
        >
          <div className="mb-5 flex items-center justify-between">
            <div className="h-10 w-10 rounded-full bg-zinc-100 animate-pulse" />
            <div className="h-3 w-12 rounded-full bg-zinc-100 animate-pulse" />
          </div>
          <div className="mb-2 h-4 w-3/4 rounded-full bg-zinc-100 animate-pulse" />
          <div className="mb-5 h-3 w-full rounded-full bg-zinc-100 animate-pulse" />
          <div className="h-3 w-2/3 rounded-full bg-zinc-100 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

/* The empty sanctuary — calm, inviting, never an error */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200/70 bg-white/40 px-6 py-20 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-purple-50 text-purple-300">
        <Feather className="h-6 w-6" />
      </div>
      <p className="font-display text-xl tracking-tight text-zinc-700">
        Your digital sanctuary is clear.
      </p>
      <p className="mt-2 text-sm text-zinc-400">
        Begin typing below to capture a thought.
      </p>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   Footer — sticky to the floor, whisper-quiet
   ────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-100/60 bg-[#FAFAFA]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 sm:flex-row sm:px-8">
        <p className="font-display text-lg text-zinc-400">Aether</p>
        <p className="text-xs text-zinc-400">
          A quieter place to think · crafted in negative space
        </p>
        <div className="flex items-center gap-5 text-xs text-zinc-400">
          <a href="#" className="transition-colors duration-300 hover:text-zinc-900">Privacy</a>
          <a href="#" className="transition-colors duration-300 hover:text-zinc-900">Manifesto</a>
          <a href="#" className="transition-colors duration-300 hover:text-zinc-900">Contact</a>
        </div>
      </div>
    </footer>
  )
}

/* ──────────────────────────────────────────────────────────────
   Page Shell — owns the live data state
   ────────────────────────────────────────────────────────────── */

export default function Home() {
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('memories')
        .select('*')
        .order('created_at', { ascending: false })

      if (!active) return

      // Table missing / RLS blocked / empty — all resolve to a calm empty state.
      if (error) {
        console.warn('Aether · could not load memories:', error.message)
        setMemories([])
      } else {
        setMemories((data as MemoryRow[]) ?? [])
      }
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [])

  const addMemory = useCallback(async (text: string): Promise<boolean> => {
    const trimmed = text.trim()
    if (!trimmed) return false

    const title =
      trimmed.length > 64 ? trimmed.slice(0, 64).trimEnd() + '…' : trimmed

    const { data, error } = await supabase
      .from('memories')
      .insert([
        { title, body: trimmed, category: 'idea', tags: ['capture'] },
      ])
      .select()
      .single()

    if (error) {
      toast.error('Could not capture that thought.', {
        description: 'The sanctuary is not reachable yet.',
      })
      console.warn('Aether · insert failed:', error.message)
      return false
    }

    if (data) {
      setMemories((prev) => [data as MemoryRow, ...prev])
      toast.success('Captured.', {
        description: 'A quiet new memory has been kept.',
      })
      return true
    }
    return false
  }, [])

  return (
    <div className="relative flex min-h-screen flex-col">
      <TheGlow />
      <TopRail />

      <main className="flex flex-1 flex-col gap-24 px-0 py-20 sm:py-28">
        <FocusCapsule onCapture={addMemory} />
        <RecapBlock />
        <MemoryFeed memories={memories} loading={loading} />
      </main>

      <Footer />

      <SonnerToaster
        position="bottom-center"
        toastOptions={{
          style: {
            borderRadius: '9999px',
            border: '1px solid rgb(244 244 245)',
            background: 'rgb(255 255 255)',
            color: 'rgb(39 39 42)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.06)',
            fontSize: '13px',
          },
        }}
      />
    </div>
  )
}
