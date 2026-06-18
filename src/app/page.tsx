'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
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
  Heart,
  LogOut,
  X,
  FolderX,
  Download,
  Trash2,
  MoreHorizontal,
  type LucideIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore, ensureAuthenticated } from '@/lib/auth-store'
import { AuthModal } from '@/components/aether/AuthModal'
import { Collections } from '@/components/aether/Collections'
import { RecapModal } from '@/components/aether/RecapModal'
import { InsightModal } from '@/components/aether/InsightModal'
import { AskAetherModal } from '@/components/aether/AskAetherModal'
import { ProfileModal } from '@/components/aether/ProfileModal'
import { Serendipity } from '@/components/aether/Serendipity'
import { useVoiceCapture } from '@/hooks/use-voice-capture'
import { initTheme } from '@/lib/theme-store'
import type { MemoryRow } from '@/lib/types'
import { logger } from '@/lib/logger'

/* ──────────────────────────────────────────────────────────────
   Types & helpers — live data layer (no more static mocks)
   ────────────────────────────────────────────────────────────── */

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

/* ──────────────────────────────────────────────────────────────
   The Signature Glow — fixed, behind everything, breathing.
   ────────────────────────────────────────────────────────────── */

function TheGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* primary purple bloom — breathing softly behind the content (20s) */}
      <div className="absolute left-1/2 top-[14%] h-[820px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-br from-purple-400/12 via-transparent to-transparent blur-[110px] animate-pulse-slow" />
      {/* secondary, offset, delayed twin */}
      <div className="absolute right-[6%] top-[42%] h-[560px] w-[560px] rounded-full bg-gradient-to-tr from-fuchsia-300/8 via-transparent to-transparent blur-[110px] animate-pulse-slow [animation-delay:-7s]" />
      {/* tertiary whisper on the left */}
      <div className="absolute left-[4%] top-[55%] h-[440px] w-[440px] rounded-full bg-gradient-to-tr from-indigo-300/8 via-transparent to-transparent blur-[110px] animate-pulse-slow [animation-delay:-12s]" />
      {/* faint warm floor wash */}
      <div className="absolute bottom-0 left-0 h-[280px] w-full bg-gradient-to-t from-purple-100/20 to-transparent blur-[80px]" />
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Minimalist Top Rail
   ────────────────────────────────────────────────────────────── */

function TopRail({ onOpenAsk, onOpenProfile }: { onOpenAsk: () => void; onOpenProfile: () => void }) {
  const user = useAuthStore((s) => s.user)
  const openModal = useAuthStore((s) => s.openModal)

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

        {/* Ask Aether — the obvious search entry (desktop) */}
        <button onClick={() => ensureAuthenticated(onOpenAsk)} className="group ml-2 hidden flex-1 sm:block">
          <span className="group relative flex items-center">
            <Search className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-zinc-400 transition-colors duration-300 group-hover:text-purple-500" />
            <span className="flex h-10 w-full max-w-md items-center rounded-full bg-white border border-zinc-100 pl-11 pr-16 text-sm text-zinc-400 shadow-[inset_0_1px_2px_rgb(0,0,0,0.03)] transition-all duration-300 group-hover:border-zinc-200 group-hover:shadow-inner">
              Ask Aether anything…
            </span>
            <kbd className="absolute right-3 hidden md:flex items-center gap-1 rounded-md border border-zinc-100 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">⌘K</kbd>
          </span>
        </button>

        {/* Mobile — compact search icon */}
        <button onClick={() => ensureAuthenticated(onOpenAsk)} aria-label="Ask Aether" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-all duration-300 hover:bg-zinc-100 hover:text-zinc-700 active:scale-95 sm:hidden">
          <Search className="h-[18px] w-[18px]" />
        </button>

        {/* Spacer for mobile */}
        <div className="flex-1 sm:hidden" />

        {/* Account pill — reactive to session */}
        {user ? (
          <button onClick={onOpenProfile} aria-label="Profile and settings" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 text-xs font-semibold text-white shadow-[0_4px_16px_rgba(139,92,246,0.3)] transition-all duration-300 hover:scale-105 active:scale-95">
            {user.email.charAt(0).toUpperCase()}
          </button>
        ) : (
          <button
            onClick={openModal}
            className="shrink-0 rounded-full border border-transparent bg-zinc-900/0 px-5 py-2 text-sm font-medium text-zinc-600 transition-all duration-300 hover:bg-zinc-900 hover:text-white hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] active:scale-95"
          >
            Sign in
          </button>
        )}
      </div>
    </header>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Gallery Greeting — in-flow hero at the top of the feed
   ────────────────────────────────────────────────────────────── */

function HeroGreeting() {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 text-center">
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-100 bg-white/60 px-4 py-1.5 text-xs font-medium text-zinc-500 backdrop-blur-sm animate-rise">
        <Sparkles className="h-[18px] w-[18px] text-purple-400" />
        A quieter place to think
      </p>

      <h1 className="font-display text-5xl sm:text-6xl leading-[1.05] tracking-tight text-zinc-900 mb-4 animate-rise [animation-delay:60ms]">
        What is on your mind
        <br className="hidden sm:block" />
        <span className="italic text-purple-400/80"> today?</span>
      </h1>

      <p className="mx-auto mb-2 max-w-md text-[15px] leading-relaxed text-zinc-500 animate-rise [animation-delay:120ms]">
        Capture a thought, ask a question, or let Aether recall what mattered.
        Nothing here rushes you.
      </p>
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Floating Capsule Tray — fixed at the base of the viewport
   A physical tray: Surface-2 depth, silent focus, addictive press.
   ────────────────────────────────────────────────────────────── */

function FloatingCapsule({
  onCapture,
  onCaptureWithImage,
}: {
  onCapture: (text: string) => void
  onCaptureWithImage: (text: string, image: string) => void
}) {
  const [value, setValue] = useState('')
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const { listening, supported, start, stop } = useVoiceCapture()

  const handleSubmit = () => {
    const text = value.trim()
    if (!text && !pendingImage) return
    ensureAuthenticated(() => {
      if (pendingImage) {
        onCaptureWithImage(text, pendingImage)
      } else {
        onCapture(text)
      }
      setValue('')
      setPendingImage(null)
    })
  }

  const handleVoice = () => {
    ensureAuthenticated(() => {
      if (listening) { stop(); return }
      if (!supported) {
        toast('Voice capture needs Chrome or Safari.', { description: 'Your browser does not support speech recognition.' })
        return
      }
      const ok = start((text) => setValue(text))
      if (ok) toast('Listening…', { description: 'Speak — Aether is transcribing.' })
    })
  }

  const handleImagePick = () => {
    ensureAuthenticated(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.style.display = 'none'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        if (file.size > 4 * 1024 * 1024) {
          toast.error('Image too large.', { description: 'Please pick an image under 4MB.' })
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          setPendingImage(reader.result as string)
          toast('Image attached.', { description: 'Add a note (optional) and press send.' })
        }
        reader.readAsDataURL(file)
        input.remove()
      }
      document.body.appendChild(input)
      input.click()
    })
  }

  return (
    <div className="fixed bottom-5 left-1/2 z-40 w-[calc(100%-2.5rem)] max-w-2xl -translate-x-1/2 animate-rise">
      {pendingImage && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl border border-zinc-100 bg-white p-2 shadow-[0_4px_20px_0_rgba(0,0,0,0.04)]">
          <img src={pendingImage} alt="Pending capture" className="h-12 w-12 rounded-lg object-cover" />
          <span className="flex-1 text-xs text-zinc-500">Image ready to capture</span>
          <button aria-label="Remove image" onClick={() => setPendingImage(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-all duration-200 hover:bg-rose-50 hover:text-rose-500 active:scale-95">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="group flex items-center gap-1 rounded-full border border-zinc-100 bg-white p-1.5 pl-6 shadow-[0_12px_60px_0_rgba(0,0,0,0.04)] backdrop-blur-sm transition-all duration-500 focus-within:shadow-[0_16px_70px_0_rgba(139,92,246,0.06)] focus-within:border-zinc-100">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
          }}
          placeholder="Capture a thought, or ask Aether…"
          className="h-12 flex-1 bg-transparent text-[15px] text-zinc-800 placeholder:text-zinc-500 focus:outline-none focus:ring-0"
        />
        <div className="flex items-center gap-0.5">
          <CapsuleAction icon={ImageIcon} label="Attach image" onClick={handleImagePick} active={!!pendingImage} />
          <CapsuleAction icon={Link2} label="Attach link" onClick={() => ensureAuthenticated(() => toast('Link attach is coming soon.'))} />
          <CapsuleAction icon={Mic} label={listening ? 'Stop listening' : 'Voice capture'} onClick={handleVoice} active={listening} />
          <button
            aria-label="Capture thought"
            onClick={handleSubmit}
            disabled={!value.trim() && !pendingImage}
            className="ml-1 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 text-white transition-all duration-300 hover:bg-purple-600 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:bg-zinc-900 disabled:hover:scale-100"
          >
            <ArrowUp className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  )
}

function CapsuleAction({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 ease-out hover:scale-105 active:scale-95 ${
        active ? 'bg-purple-100 text-purple-600 animate-pulse' : 'text-zinc-400 hover:bg-purple-50/80 hover:text-purple-600'
      }`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Executive 24h Recap Block
   ────────────────────────────────────────────────────────────── */

function RecapBlock({ onReadRecap }: { onReadRecap: () => void }) {
  return (
    <section className="mx-auto w-full max-w-5xl px-5 animate-rise [animation-delay:240ms]">
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600 p-8 sm:p-12 shadow-[0_30px_80px_-20px_rgba(139,92,246,0.45)]">
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
            <button
              onClick={onReadRecap}
              className="group ml-auto inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-all duration-300 hover:bg-white hover:text-purple-700 active:scale-95"
            >
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
  memories, loading, favorites, onToggleFavorite, onInsight, onDownloadPdf, onDelete, activeFolder, onClearFolder, highlightId,
}: {
  memories: MemoryRow[]
  loading: boolean
  favorites: Set<string>
  onToggleFavorite: (id: string) => void
  onInsight: (m: MemoryRow) => void
  onDownloadPdf: (m: MemoryRow) => void
  onDelete: (m: MemoryRow) => void
  activeFolder: string | null
  onClearFolder: () => void
  highlightId: string | null
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-5">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h3 className="font-display text-2xl tracking-tight text-zinc-900">
            {activeFolder ? (
              <span className="inline-flex items-center gap-2.5">
                Recent memories
                <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 px-3 py-0.5 text-xs font-medium capitalize text-purple-600">
                  {activeFolder}
                  <button
                    aria-label="Clear filter"
                    onClick={onClearFolder}
                    className="transition-transform duration-200 hover:scale-110"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              </span>
            ) : (
              'Recent memories'
            )}
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            {activeFolder
              ? `Filtered to the “${activeFolder}” collection.`
              : 'A gentle stream of what you’ve kept.'}
          </p>
        </div>
        <button
          onClick={() =>
            ensureAuthenticated(() =>
              toast('Opening your full archive…', {
                description: 'Every kept thought, in one place.',
              })
            )
          }
          className="group inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors duration-300 hover:text-zinc-900 active:scale-95"
        >
          View all
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
        </button>
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : memories.length === 0 ? (
        activeFolder ? (
          <FilteredEmptyState tag={activeFolder} onClear={onClearFolder} />
        ) : (
          <EmptyState />
        )
      ) : (
        /* Gallery masonry — cards of varying heights stack like a high-end gallery */
        <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 [column-fill:_balance]">
          {memories.map((m) => (
            <div key={m.id} id={`memory-${m.id}`} className={`mb-5 break-inside-avoid rounded-2xl transition-all duration-700 ${highlightId === m.id ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-[#FAFAFA]' : ''}`}>
              <MemoryCard
                memory={m}
                favorited={favorites.has(m.id)}
                onToggleFavorite={onToggleFavorite}
                onInsight={onInsight}
                onDownloadPdf={onDownloadPdf}
                onDelete={onDelete}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function MemoryCard({
  memory, favorited, onToggleFavorite, onInsight, onDownloadPdf, onDelete,
}: {
  memory: MemoryRow
  favorited: boolean
  onToggleFavorite: (id: string) => void
  onInsight: (m: MemoryRow) => void
  onDownloadPdf: (m: MemoryRow) => void
  onDelete: (m: MemoryRow) => void
}) {
  // Prefer AI tags from the metadata JSONB; fall back to the top-level tags column.
  const pills =
    (memory.metadata?.tags?.length ? memory.metadata.tags : memory.tags) ?? []
  const processing = memory.processing === true
  const imageData = memory.metadata?.imageData
  const imageDesc = memory.metadata?.imageDescription
  const audioData = memory.metadata?.audioData
  const [showImage, setShowImage] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const toggleAudio = () => {
    if (!audioRef.current) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play(); setPlaying(true) }
  }

  return (
    <article className="group rounded-2xl border border-zinc-100/60 bg-white p-6 shadow-[0_4px_20px_0_rgba(0,0,0,0.015)] transition-all duration-500 hover:shadow-[0_12px_60px_0_rgba(0,0,0,0.04)] hover:-translate-y-0.5 hover:border-zinc-200/60">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-50 text-zinc-400 transition-all duration-300 group-hover:bg-purple-50 group-hover:text-purple-500">
          {processing ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <CategoryIcon category={memory.category} className="h-[18px] w-[18px]" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Favorite toggle */}
          <button
            aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => ensureAuthenticated(() => onToggleFavorite(memory.id))}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-300 hover:scale-110 active:scale-95 ${
              favorited ? 'text-rose-500' : 'text-zinc-300 hover:text-rose-400'
            }`}
          >
            <Heart className={`h-4 w-4 ${favorited ? 'fill-current' : ''}`} />
          </button>
          <span className="text-xs text-zinc-400">
            {processing ? 'Refining…' : timeAgo(memory.created_at)}
          </span>
        </div>
      </div>

      <h4 className="mb-2 text-[15px] font-semibold tracking-tight text-zinc-900">
        {memory.title}
      </h4>

      {/* Show the original image if available */}
      {imageData && (
        <div className="mb-3">
          {showImage ? (
            <div className="relative">
              <img src={imageData} alt={memory.title} className="w-full rounded-xl" />
              <button aria-label="Hide image" onClick={() => setShowImage(false)} className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white transition-all hover:bg-black/70 active:scale-95"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <button onClick={() => setShowImage(true)} className="flex w-full items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50/50 p-2 transition-all duration-300 hover:border-zinc-200 hover:bg-zinc-50 active:scale-[0.98]">
              <img src={imageData} alt="" className="h-12 w-12 rounded-lg object-cover" />
              <span className="flex-1 text-left text-xs text-zinc-500">View original image</span>
              <ImageIcon className="h-4 w-4 text-zinc-400" />
            </button>
          )}
        </div>
      )}

      {/* Voice note playback */}
      {audioData && (
        <div className="mb-3">
          <audio ref={audioRef} src={audioData} onEnded={() => setPlaying(false)} className="hidden" />
          <button onClick={toggleAudio} className="flex w-full items-center gap-3 rounded-xl border border-zinc-100 bg-zinc-50/50 p-2 transition-all duration-300 hover:border-purple-200 hover:bg-purple-50/40 active:scale-[0.98]">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-600">
              {playing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            </div>
            <span className="flex-1 text-left text-xs text-zinc-500">{playing ? 'Playing voice note…' : 'Play voice note'}</span>
          </button>
        </div>
      )}

      <p className="mb-5 text-sm leading-relaxed text-zinc-500">
        {memory.body}
      </p>

      {/* Show the AI's image description if available */}
      {!processing && imageDesc && (
        <div className="mb-4 flex gap-2 rounded-xl bg-zinc-50/60 px-3 py-2.5">
          <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
          <p className="text-xs leading-relaxed text-zinc-500">{imageDesc}</p>
        </div>
      )}

      {!processing && memory.summary && (
        <div className="mb-4 flex gap-2 rounded-xl bg-purple-50/50 px-3 py-2.5">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-400" />
          <p className="text-xs italic leading-relaxed text-purple-700/70">{memory.summary}</p>
        </div>
      )}

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

/* Filtered empty state — shown when a folder yields no matches */
function FilteredEmptyState({
  tag,
  onClear,
}: {
  tag: string
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200/70 bg-white/40 px-6 py-20 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-50 text-zinc-300">
        <FolderX className="h-6 w-6" />
      </div>
      <p className="font-display text-xl tracking-tight text-zinc-700">
        Nothing here yet.
      </p>
      <p className="mt-2 text-sm text-zinc-400">
        No memories in the <span className="capitalize font-medium text-zinc-500">{tag}</span> collection.
      </p>
      <button
        onClick={onClear}
        className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-all duration-300 hover:bg-purple-600 hover:scale-105 active:scale-95"
      >
        Show all memories
      </button>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   Footer — sticky to the floor, whisper-quiet
   ────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-100/60 bg-[#FAFAFA]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 pt-6 pb-28 sm:flex-row sm:px-8">
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
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [recapOpen, setRecapOpen] = useState(false)
  const [insightOpen, setInsightOpen] = useState(false)
  const [insightMemory, setInsightMemory] = useState<MemoryRow | null>(null)
  const [askOpen, setAskOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const user = useAuthStore((s) => s.user)
  const userId = user?.id

  // Restore the real Supabase session on mount and keep the auth store in sync.
  useEffect(() => {
    initTheme()
    supabase.auth.getSession().then(({ data: { session } }) => {
      useAuthStore.getState().setSession(session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      useAuthStore.getState().setSession(session)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])

  // Load only the current user's memories.
  useEffect(() => {
    let active = true
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!active) return
      if (!session?.user) { setMemories([]); setLoading(false); return }
      const { data, error } = await supabase
        .from('memories')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
      if (!active) return
      if (error) { logger.warn('Aether · could not load memories:', error.message); setMemories([]) }
      else { setMemories((data as MemoryRow[]) ?? []) }
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [userId])

  // Silent re-fetch used to pick up background-enriched rows.
  const refetch = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
    if (error || !data) return
    const rows = data as MemoryRow[]
    setMemories((prev) => {
      const pending = prev.filter((m) => m.id.startsWith('temp-'))
      return [...pending, ...rows]
    })
  }, [])

  // Snappy ingestion — push an optimistic card instantly, then fire the
  // POST to /api/capture. The card shows a spinner until the background
  // Gemini enrichment writes back (picked up by delayed refetches).
  const addMemory = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: MemoryRow = {
        id: tempId,
        title: 'Capturing thought…',
        body: trimmed,
        summary: null,
        category: 'idea',
        tags: ['capture'],
        processing: true,
        user_id: null,
        metadata: null,
        created_at: new Date().toISOString(),
      }
      setMemories((prev) => [optimistic, ...prev])

      void (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session?.user) {
            setMemories((prev) => prev.filter((m) => m.id !== tempId))
            toast.error('Please sign in to capture thoughts.')
            return
          }
          const res = await fetch('/api/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ content: trimmed }),
          })
          const json = (await res.json()) as { success?: boolean; id?: string; error?: string }
          if (!res.ok || !json.success) {
            if (res.status === 401) throw new Error('Your session has expired — please sign in again.')
            throw new Error(json.error || 'Could not capture that thought.')
          }
          const realId = json.id as string
          setMemories((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: realId, user_id: session.user.id } : m)))
          toast.success('Captured.', { description: 'Aether is refining it in the background.' })
          setTimeout(() => void refetch(), 3500)
          setTimeout(() => void refetch(), 8000)
        } catch (err) {
          setMemories((prev) => prev.filter((m) => m.id !== tempId))
          if (err instanceof TypeError) {
            toast.error('Could not capture that thought.', { description: 'The sanctuary is not reachable yet.' })
          } else {
            toast.error(err instanceof Error ? err.message : 'Could not capture that thought.')
          }
          logger.warn('Aether · capture failed:', err instanceof Error ? err.message : err)
        }
      })()
    },
    [refetch]
  )

  // Capture with an image — sends the image base64 to the server, which
  // analyzes it with the VLM and enriches the memory with its content.
  const addMemoryWithImage = useCallback(
    (text: string, image: string) => {
      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: MemoryRow = {
        id: tempId,
        title: 'Capturing image…',
        body: text || 'Image capture',
        summary: null,
        category: 'image',
        tags: ['capture'],
        processing: true,
        user_id: null,
        metadata: null,
        created_at: new Date().toISOString(),
      }
      setMemories((prev) => [optimistic, ...prev])

      void (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session?.user) {
            setMemories((prev) => prev.filter((m) => m.id !== tempId))
            toast.error('Please sign in to capture thoughts.')
            return
          }
          const res = await fetch('/api/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ content: text, image }),
          })
          const json = (await res.json()) as { success?: boolean; id?: string; error?: string }
          if (!res.ok || !json.success) {
            throw new Error(json.error || 'Could not capture that image.')
          }
          const realId = json.id as string
          setMemories((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: realId, user_id: session.user.id } : m)))
          toast.success('Image captured.', { description: 'Aether is reading it in the background.' })
          setTimeout(() => void refetch(), 5000)
          setTimeout(() => void refetch(), 10000)
        } catch (err) {
          setMemories((prev) => prev.filter((m) => m.id !== tempId))
          if (err instanceof TypeError) {
            toast.error('Could not capture that image.', { description: 'The sanctuary is not reachable yet.' })
          } else {
            toast.error(err instanceof Error ? err.message : 'Could not capture that image.')
          }
          logger.warn('Aether · image capture failed:', err instanceof Error ? err.message : err)
        }
      })()
    },
    [refetch]
  )

  // Favorite toggle — only ever called once ensureAuthenticated has passed.
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const downloadPdf = useCallback(async (memory: MemoryRow) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { toast.error('Please sign in to download.'); return }
    try {
      const res = await fetch('/api/pdf', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ id: memory.id }) })
      if (!res.ok) throw new Error('PDF failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(memory.title || 'aether-memory').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase()}.pdf`
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      toast.success('Downloaded.', { description: 'Your thought is saved as a PDF.' })
    } catch { toast.error('Could not generate the PDF.') }
  }, [])

  const deleteMemory = useCallback(async (memory: MemoryRow) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { toast.error('Please sign in to delete.'); return }
    try {
      const res = await fetch('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ id: memory.id }) })
      const json = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) throw new Error(json.error || 'Delete failed')
      setMemories((prev) => prev.filter((m) => m.id !== memory.id))
      toast.success('Memory removed.', { description: 'The thought has been let go.' })
    } catch { toast.error('Could not delete that memory.') }
  }, [])

  // Phase 5 — filter memories by the active folder tag (derived live from DB).
  // Reads tags from the metadata JSONB first, falling back to the top-level column.
  const visibleMemories = useMemo(
    () =>
      activeFolder === null
        ? memories
        : memories.filter((m) => {
            const tags =
              m.metadata?.tags?.length ? m.metadata.tags : (m.tags ?? [])
            return tags.includes(activeFolder)
          }),
    [memories, activeFolder]
  )

  return (
    <div className="relative flex min-h-screen flex-col">
      <TheGlow />
      <TopRail onOpenAsk={() => setAskOpen(true)} onOpenProfile={() => setProfileOpen(true)} />

      <main className="flex flex-1 flex-col gap-20 px-0 pb-40 pt-20 sm:pt-28">
        <HeroGreeting />
        <RecapBlock onReadRecap={() => ensureAuthenticated(() => setRecapOpen(true))} />
        <Collections memories={memories} activeFolder={activeFolder} onSelectFolder={setActiveFolder} />
        <Serendipity memories={memories} />
        <MemoryFeed
          memories={visibleMemories}
          loading={loading}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onInsight={(m) => { setInsightMemory(m); setInsightOpen(true) }}
          onDownloadPdf={downloadPdf}
          onDelete={deleteMemory}
          activeFolder={activeFolder}
          onClearFolder={() => setActiveFolder(null)}
          highlightId={highlightId}
        />
      </main>

      <Footer />

      <FloatingCapsule onCapture={addMemory} onCaptureWithImage={addMemoryWithImage} />

      <AuthModal />
      <RecapModal open={recapOpen} onClose={() => setRecapOpen(false)} />
      <InsightModal open={insightOpen} memoryId={insightMemory?.id ?? null} memoryTitle={insightMemory?.title ?? ''} onClose={() => setInsightOpen(false)} />
      <AskAetherModal open={askOpen} memories={memories} onClose={() => setAskOpen(false)} onFocusMemory={(id) => { setActiveFolder(null); setHighlightId(id); setTimeout(() => setHighlightId((c) => c === id ? null : c), 4000); setTimeout(() => { const el = document.getElementById(`memory-${id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100); }} />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />

      <SonnerToaster
        position="top-center"
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
