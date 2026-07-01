'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { createPortal } from 'react-dom'
import { toast, Toaster as SonnerToaster } from 'sonner'
import {
  Search,
  Image as ImageIcon,
  Mic,
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
  Sun,
  Moon,
  X,
  FolderX,
  Download,
  Trash2,
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
import { LegalModal } from '@/components/aether/LegalModal'
import { UpgradeModal } from '@/components/upgrade-modal'
import { ErrorBoundary } from '@/components/error-boundary'
import { useVoiceCapture } from '@/hooks/use-voice-capture'
import { useVoiceRecorder } from '@/hooks/use-voice-recorder'
import { useOfflineQueue } from '@/hooks/use-offline-queue'
import { LiveWaveform, ReplayWaveform } from '@/components/aether/VoiceWaveform'
import { initTheme, useThemeStore } from '@/lib/theme-store'
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
    case 'ideas':
      return <Lightbulb className={className} />
    case 'reading':
      return <BookOpen className={className} />
    case 'strategy':
    case 'work':
    case 'task':
      return <Compass className={className} />
    case 'quote':
      return <Feather className={className} />
    case 'design':
      return <Palette className={className} />
    case 'ritual':
      return <Coffee className={className} />
    case 'money':
      return <Coffee className={className} />
    case 'health':
      return <Coffee className={className} />
    case 'relationships':
      return <Heart className={className} />
    case 'image':
      return <ImageIcon className={className} />
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
      {/* primary purple-rose bloom — breathing softly behind the content (20s) */}
      <div className="absolute left-1/2 top-[14%] h-[820px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-br from-purple-100/30 to-rose-100/20 dark:from-purple-500/8 dark:to-fuchsia-500/6 blur-[110px] animate-pulse-slow" />
      {/* secondary, offset, delayed twin */}
      <div className="absolute right-[6%] top-[42%] h-[560px] w-[560px] rounded-full bg-gradient-to-tr from-rose-100/15 to-purple-100/10 dark:from-fuchsia-500/5 dark:to-transparent blur-[110px] animate-pulse-slow [animation-delay:-7s]" />
      {/* tertiary whisper on the left */}
      <div className="absolute left-[4%] top-[55%] h-[440px] w-[440px] rounded-full bg-gradient-to-tr from-purple-100/12 to-rose-100/8 dark:from-indigo-500/5 dark:to-transparent blur-[110px] animate-pulse-slow [animation-delay:-12s]" />
      {/* faint warm floor wash */}
      <div className="absolute bottom-0 left-0 h-[280px] w-full bg-gradient-to-t from-purple-100/20 to-transparent dark:from-purple-900/10 dark:to-transparent blur-[80px]" />
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   The Minimalist Top Rail
   ────────────────────────────────────────────────────────────── */

function TopRail({ onOpenAsk, onOpenProfile }: { onOpenAsk: () => void; onOpenProfile: () => void }) {
  const user = useAuthStore((s) => s.user)
  const openModal = useAuthStore((s) => s.openModal)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const isDark = theme === 'dark'

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-[#FCFBF9]/70 dark:bg-[#09090B]/70 border-b border-zinc-200/50 dark:border-zinc-800/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:px-8">
        {/* Wordmark */}
        <a
          href="#"
          className="font-display text-2xl tracking-tight text-zinc-900 dark:text-zinc-50 leading-none select-none"
        >
          Aether
        </a>

        {/* Ask Aether — the obvious search entry (desktop) */}
        <button onClick={() => ensureAuthenticated(onOpenAsk)} className="group ml-2 hidden flex-1 sm:block">
          <span className="group relative flex items-center">
            <Search className="pointer-events-none absolute left-4 h-[18px] w-[18px] text-zinc-400 dark:text-zinc-500 transition-colors duration-300 group-hover:text-purple-500" />
            <span className="flex h-10 w-full max-w-md items-center rounded-full bg-white dark:bg-[#18181B] border border-zinc-200/50 dark:border-zinc-800/60 pl-11 pr-3 text-sm text-zinc-400 dark:text-zinc-500 shadow-[inset_0_1px_2px_rgb(0,0,0,0.03)] transition-all duration-300 group-hover:border-zinc-200 dark:hover:border-zinc-700 group-hover:shadow-inner">
              Ask Aether anything…
            </span>
            <span className="absolute right-3 hidden md:flex items-center rounded-md border border-zinc-200/50 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-800/50 px-2 py-0.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">Ask Aether</span>
          </span>
        </button>

        {/* Mobile — compact search icon */}
        <button onClick={() => ensureAuthenticated(onOpenAsk)} aria-label="Ask Aether" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition-all duration-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300 active:scale-95 sm:hidden">
          <Search className="h-[18px] w-[18px]" />
        </button>

        {/* Spacer for mobile */}
        <div className="flex-1 sm:hidden" />

        {/* Theme toggle — sun/moon pill */}
        <button
          type="button"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={isDark}
          onClick={toggleTheme}
          title={isDark ? 'Light mode' : 'Dark mode'}
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300 backdrop-blur-sm transition-all duration-300 hover:scale-105 hover:border-purple-400 hover:text-purple-500 active:scale-95"
        >
          {/* Sun (visible in light) */}
          <Sun className={`absolute h-[18px] w-[18px] transition-all duration-300 ${isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} />
          {/* Moon (visible in dark) */}
          <Moon className={`absolute h-[18px] w-[18px] transition-all duration-300 ${isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'}`} />
        </button>

        {/* Account pill — reactive to session */}
        {user ? (
          <button onClick={onOpenProfile} aria-label="Profile and settings" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 text-xs font-semibold text-white shadow-[0_4px_16px_rgba(139,92,246,0.3)] transition-all duration-300 hover:scale-105 active:scale-95">
            {user.email.charAt(0).toUpperCase()}
          </button>
        ) : (
          <button
            onClick={openModal}
            className="shrink-0 rounded-full border border-transparent bg-zinc-900/0 px-5 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition-all duration-300 hover:bg-zinc-900 hover:text-white hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] active:scale-95"
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
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200/50 dark:border-zinc-800/60 bg-white/60 dark:bg-zinc-900/60 px-4 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 backdrop-blur-sm animate-rise">
        <Sparkles className="h-[18px] w-[18px] text-purple-400" />
        A quieter place to think
      </p>

      <h1 className="font-display text-5xl sm:text-6xl leading-[1.05] tracking-tight text-zinc-900 dark:text-zinc-50 mb-4 animate-rise [animation-delay:60ms]">
        What is on your mind
        <br className="hidden sm:block" />
        <span className="italic text-purple-400/80"> today?</span>
      </h1>

      <p className="mx-auto mb-2 max-w-md text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-500 animate-rise [animation-delay:120ms]">
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
  onCaptureWithAudio,
  userTier,
  onUpgrade,
}: {
  onCapture: (text: string) => void
  onCaptureWithImage: (text: string, image: string) => void
  onCaptureWithAudio: (text: string, audio: string) => void
  userTier: string
  onUpgrade: () => void
}) {
  const isFreeTier = userTier === 'mist'
  const ALLOWED_FREE_ACTIONS = 3
  const [freeActionsUsed, setFreeActionsUsed] = useState(0)
  const [value, setValue] = useState('')

  // Load free action count from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const used = parseInt(localStorage.getItem('aether-free-actions') || '0', 10)
      setFreeActionsUsed(used)
    }
  }, [])

  // Check if free user has exceeded their 3-action allowance
  const canUsePremiumAction = (): boolean => {
    if (!isFreeTier) return true
    if (freeActionsUsed >= ALLOWED_FREE_ACTIONS) return false
    // Increment the counter
    const newCount = freeActionsUsed + 1
    setFreeActionsUsed(newCount)
    if (typeof window !== 'undefined') localStorage.setItem('aether-free-actions', String(newCount))
    return true
  }
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false) // Rage-click protection lock
  // useVoiceCapture handles speech-to-text transcription (Web Speech API)
  const { listening, supported, start, stop, audioData } = useVoiceCapture()
  // useVoiceRecorder handles native audio recording + real-time frequency analysis
  const recorder = useVoiceRecorder()
  const recorderReady = recorder.audioData && !recorder.listening

  const handleSubmit = () => {
    // Rage-click protection: hard drop any accidental or rapid double-clicks
    if (isProcessing) return
    const text = value.trim()
    // Prefer the high-fidelity recorder audio if available; fall back to the legacy capture audio.
    const finalAudio = recorderReady ? recorder.audioData : audioData
    if (!text && !pendingImage && !finalAudio) return
    setIsProcessing(true)
    ensureAuthenticated(() => {
      try {
        if (pendingImage) {
          onCaptureWithImage(text, pendingImage)
        } else if (finalAudio) {
          onCaptureWithAudio(text || 'Voice note', finalAudio)
        } else {
          onCapture(text)
        }
        setValue('')
        setPendingImage(null)
      } catch (err) {
        logger.warn('Aether · capture pipeline drop:', err instanceof Error ? err.message : err)
        toast.error('Sanctuary busy. One moment…')
      } finally {
        setIsProcessing(false)
      }
    })
  }

  const handleVoice = () => {
    // Pre-flight gate: free tier gets 3 premium actions, then paywall
    if (isFreeTier && !canUsePremiumAction()) { onUpgrade(); return }
    ensureAuthenticated(() => {
      if (listening || recorder.listening) {
        stop()
        recorder.stop()
        return
      }
      if (!supported) {
        toast('Voice capture needs Chrome or Safari.', { description: 'Your browser does not support speech recognition.' })
        return
      }
      // Start BOTH the speech-to-text transcriber AND the native audio recorder.
      // The recorder provides high-fidelity frequency data for the live waveform
      // and a better-quality audio blob for storage.
      recorder.start()
      const ok = start((text) => setValue(text))
      if (ok) toast('Listening…', { description: 'Speak — Aether is transcribing.' })
    })
  }

  const handleImagePick = () => {
    // Pre-flight gate: free tier gets 3 premium actions, then paywall
    if (isFreeTier && !canUsePremiumAction()) { onUpgrade(); return }
    ensureAuthenticated(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.style.display = 'none'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        if (file.size > 2 * 1024 * 1024) {
          toast.error('Image too large.', { description: 'Please pick an image under 2MB.' })
          return
        }
        // Compress the image to a reasonable size for storage.
        const img = new Image()
        const reader = new FileReader()
        reader.onload = () => {
          img.src = reader.result as string
          img.onload = () => {
            const canvas = document.createElement('canvas')
            const maxDim = 768
            let { width, height } = img
            if (width > maxDim || height > maxDim) {
              if (width > height) { height = Math.round(height * maxDim / width); width = maxDim }
              else { width = Math.round(width * maxDim / height); height = maxDim }
            }
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            if (!ctx) { setPendingImage(reader.result as string); return }
            ctx.drawImage(img, 0, 0, width, height)
            const compressed = canvas.toDataURL('image/jpeg', 0.7)
            setPendingImage(compressed)
            toast('Image attached.', { description: 'Add a note (optional) and press send.' })
          }
        }
        reader.readAsDataURL(file)
        input.remove()
      }
      document.body.appendChild(input)
      input.click()
    })
  }

  return (
    <div className="fixed bottom-3 sm:bottom-5 left-1/2 z-40 w-[calc(100%-1.5rem)] sm:w-[calc(100%-2.5rem)] max-w-2xl -translate-x-1/2 animate-rise">
      {pendingImage && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#18181B] p-2 shadow-[0_8px_30px_rgb(0,0,0,0.015)] dark:shadow-none">
          <img src={pendingImage} alt="Pending capture" className="h-12 w-12 rounded-lg object-cover" />
          <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">Image ready to capture</span>
          <button aria-label="Remove image" onClick={() => setPendingImage(null)} className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition-all duration-200 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-500 active:scale-95">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="aether-glass-capsule group flex items-center gap-0.5 sm:gap-1 rounded-full border border-zinc-200/50 dark:border-zinc-800/80 bg-white p-1.5 pl-4 sm:pl-6 shadow-[0_8px_30px_rgb(0,0,0,0.015)] backdrop-blur-sm transition-all duration-500 focus-within:shadow-[0_16px_70px_0_rgba(139,92,246,0.06)] focus-within:border-zinc-200 dark:focus-within:border-purple-500/40">
        {/* When recording, morph the input into a live audio deck */}
        {listening || recorder.listening ? (
          <div className="flex h-12 flex-1 items-center gap-3 px-1">
            <span className="flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-rose-500" />
            <LiveWaveform frequencyData={recorder.frequencyData} barCount={28} />
            <span className="shrink-0 text-xs font-medium text-purple-500 dark:text-purple-400">REC</span>
          </div>
        ) : (
          <input
            value={value}
            onChange={(e) => {
              const newValue = e.target.value
              // Pre-flight gate: free tier gets 3 premium actions, then paywall
              const containsUrl = /(https?:\/\/[^\s]+)/i.test(newValue)
              if (isFreeTier && containsUrl && !canUsePremiumAction()) {
                const flushed = newValue.replace(/(https?:\/\/[^\s]+)/gi, '').trim()
                setValue(flushed)
                onUpgrade()
                return
              }
              setValue(newValue)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
            }}
            placeholder="Capture a thought, or ask Aether…"
            className="h-12 flex-1 min-w-0 bg-transparent text-[16px] sm:text-[15px] text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-0"
          />
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          <CapsuleAction icon={ImageIcon} label="Attach image" onClick={handleImagePick} active={!!pendingImage} />
          <CapsuleAction icon={Mic} label={listening || recorder.listening ? 'Stop recording' : 'Voice capture'} onClick={handleVoice} active={listening || recorder.listening} />
          <button
            aria-label="Capture thought"
            onClick={handleSubmit}
            disabled={!value.trim() && !pendingImage && !recorderReady && !audioData}
            className="ml-0.5 sm:ml-1 flex h-9 w-9 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white transition-all duration-300 hover:bg-purple-600 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:bg-zinc-900 disabled:hover:scale-100"
          >
            <ArrowUp className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
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
      className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full transition-all duration-300 ease-out hover:scale-105 active:scale-95 ${
        active ? 'bg-purple-100 text-purple-600 animate-pulse' : 'text-zinc-400 dark:text-zinc-500 hover:bg-purple-50/80 hover:text-purple-600'
      }`}
    >
      <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
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
  memories, loading, favorites, onToggleFavorite, onInsight, onDownloadPdf, onDelete, activeFolder, onClearFolder, highlightId, onAskAboutImage, onViewAll,
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
  onAskAboutImage: (image: string) => void
  onViewAll: () => void
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-5">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h3 className="font-display text-2xl tracking-tight text-zinc-900 dark:text-zinc-100">
            {activeFolder ? (
              <span className="inline-flex items-center gap-2.5">
                Recent memories
                <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-50 dark:bg-purple-500/15 px-3 py-0.5 text-xs font-medium capitalize text-purple-600 dark:text-purple-300">
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
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {activeFolder
              ? `Filtered to the “${activeFolder}” collection.`
              : 'A gentle stream of what you’ve kept.'}
          </p>
        </div>
        <button
          onClick={() => ensureAuthenticated(onViewAll)}
          className="group inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-500 transition-colors duration-300 hover:text-zinc-900 dark:hover:text-zinc-50 dark:text-zinc-50 active:scale-95"
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
                onAskAboutImage={onAskAboutImage}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function MemoryCard({
  memory, favorited, onToggleFavorite, onInsight, onDownloadPdf, onDelete, onAskAboutImage,
}: {
  memory: MemoryRow
  favorited: boolean
  onToggleFavorite: (id: string) => void
  onInsight: (m: MemoryRow) => void
  onDownloadPdf: (m: MemoryRow) => void
  onDelete: (m: MemoryRow) => void
  onAskAboutImage: (image: string) => void
}) {
  const processing = memory.processing === true
  const imageData = memory.metadata?.imageData
  const audioData = memory.metadata?.audioData
  const [showImage, setShowImage] = useState(false)

  return (
    <article className="group rounded-2xl border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#18181B] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.015)] dark:shadow-none transition-all duration-500 hover:shadow-[0_12px_60px_0_rgba(0,0,0,0.04)] dark:hover:shadow-none hover:-translate-y-0.5 hover:border-zinc-200 dark:hover:border-zinc-700/60">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-50 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-500 transition-all duration-300 group-hover:bg-purple-50 dark:group-hover:bg-purple-500/10 group-hover:text-purple-500">
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
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {processing ? 'Refining…' : timeAgo(memory.created_at)}
          </span>
        </div>
      </div>

      <h4 className="mb-2 font-display text-lg font-normal tracking-tight text-zinc-900 dark:text-zinc-50">
        {memory.title}
      </h4>

      {/* Image — clean framed thumbnail, expands on click, shrinks on unhover */}
      {imageData && (
        <div className="mb-4 overflow-hidden rounded-xl border border-zinc-200/50 dark:border-zinc-800/60 transition-all duration-500">
          {showImage ? (
            <div className="relative">
              <img src={imageData} alt={memory.title} className="w-full max-h-[400px] object-contain bg-zinc-50 dark:bg-zinc-800/50" />
              <button aria-label="Collapse image" onClick={() => setShowImage(false)} className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-all hover:bg-black/60 active:scale-95">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button onClick={() => setShowImage(true)} className="group/img relative block w-full overflow-hidden">
              <img src={imageData} alt={memory.title} className="w-full max-h-32 object-cover transition-all duration-500 group-hover/img:max-h-48 group-hover/img:scale-[1.02]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent transition-opacity duration-300 group-hover/img:from-black/40" />
              <div className="absolute bottom-2 left-3 flex items-center gap-1.5">
                <ImageIcon className="h-3 w-3 text-white/80" />
                <span className="text-[10px] font-medium text-white/80">Click to expand</span>
              </div>
            </button>
          )}
        </div>
      )}

      {/* Voice note — native waveform replay with progressive playhead tinting */}
      {audioData && (
        <div className="mb-4">
          <ReplayWaveform audioData={audioData} barCount={28} />
        </div>
      )}

      <p className="mb-5 font-display text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-300 break-words line-clamp-4">
        {memory.body?.replace(/\s*\[Image content:[\s\S]*?\]\s*/g, '').trim().replace(/(https?:\/\/[^\s]{20,})/g, (url) => {
          const clean = url.replace(/^https?:\/\/(www\.)?/, '').split(/[?#]/)[0]
          return clean.length > 30 ? clean.slice(0, 30) + '…' : clean
        }) || memory.body}
      </p>

      {/* Action row: insight / ask-about-image / PDF / delete — appears on hover */}
      {!processing && (
        <div className="mt-4 flex items-center justify-end gap-1 opacity-100 md:opacity-0 transition-opacity duration-300 md:group-hover:opacity-100">
          <button
            aria-label="AI insight"
            onClick={() => ensureAuthenticated(() => onInsight(memory))}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition-all duration-300 hover:scale-110 hover:bg-purple-50 dark:hover:bg-purple-500/10 hover:text-purple-600 dark:hover:text-purple-400 active:scale-95"
          >
            <Sparkles className="h-4 w-4" />
          </button>
          {/* Ask about this image — only shown when the memory has an image attachment */}
          {imageData && (
            <button
              aria-label="Ask Aether about this image"
              onClick={() => ensureAuthenticated(() => onAskAboutImage(imageData))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition-all duration-300 hover:scale-110 hover:bg-purple-50 dark:hover:bg-purple-500/10 hover:text-purple-600 dark:hover:text-purple-400 active:scale-95"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
          <button
            aria-label="Download as PDF"
            onClick={() => ensureAuthenticated(() => onDownloadPdf(memory))}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition-all duration-300 hover:scale-110 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300 dark:text-zinc-300 active:scale-95"
          >
            <Download className="h-4 w-4" />
          </button>
          <DeleteButton memory={memory} onDelete={onDelete} />
        </div>
      )}
    </article>
  )
}

/* Delete button with two-step confirm */
function DeleteButton({ memory, onDelete }: { memory: MemoryRow; onDelete: (m: MemoryRow) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (confirmDelete) {
    return (
      <div className="flex items-center gap-1 rounded-full bg-rose-50 dark:bg-rose-500/10 px-1 py-0.5">
        <button
          aria-label="Confirm delete"
          onClick={() => onDelete(memory)}
          className="flex h-7 items-center justify-center gap-1 rounded-full bg-rose-500 px-3 text-xs font-medium text-white transition-all duration-200 hover:bg-rose-600 active:scale-95"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <button
          aria-label="Cancel delete"
          onClick={() => setConfirmDelete(false)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-rose-400 dark:text-rose-400 transition-all duration-200 hover:bg-rose-100 dark:hover:bg-rose-500/15 active:scale-95"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }
  return (
    <button
      aria-label="Delete memory"
      onClick={() => ensureAuthenticated(() => setConfirmDelete(true))}
      className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition-all duration-300 hover:scale-110 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-500 active:scale-95"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  )
}

/* Premium loading skeletons — quiet pulse, never blocks render */
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#18181B] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.015)] dark:shadow-none"
        >
          <div className="mb-5 flex items-center justify-between">
            <div className="h-10 w-10 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
            <div className="h-3 w-12 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          </div>
          <div className="mb-2 h-4 w-3/4 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          <div className="mb-5 h-3 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          <div className="h-3 w-2/3 rounded-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

/* The empty sanctuary — calm, inviting, never an error */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200/70 dark:border-zinc-800/70 bg-white/40 dark:bg-zinc-900/40 px-6 py-20 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-purple-50 dark:bg-purple-500/10 text-purple-300 dark:text-zinc-700">
        <Feather className="h-6 w-6" />
      </div>
      <p className="font-display text-xl tracking-tight text-zinc-700 dark:text-zinc-200">
        Your digital sanctuary is clear.
      </p>
      <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200/70 dark:border-zinc-800/70 bg-white/40 dark:bg-zinc-900/40 px-6 py-20 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-50 dark:bg-zinc-800/50 text-zinc-300 dark:text-zinc-700">
        <FolderX className="h-6 w-6" />
      </div>
      <p className="font-display text-xl tracking-tight text-zinc-700 dark:text-zinc-200">
        Nothing here yet.
      </p>
      <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
        No memories in the <span className="capitalize font-medium text-zinc-500 dark:text-zinc-400">{tag}</span> collection.
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

function Footer({ onOpenLegal }: { onOpenLegal: (type: 'privacy' | 'manifesto' | 'contact') => void }) {
  return (
    <footer className="mt-auto border-t border-zinc-200/50 dark:border-zinc-800/60 bg-[#FCFBF9]/70 dark:bg-[#09090B]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 pt-6 pb-28 sm:flex-row sm:px-8">
        <p className="font-display text-lg text-zinc-400 dark:text-zinc-500">Aether</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          A quieter place to think · crafted in negative space
        </p>
        <div className="flex items-center gap-5 text-xs text-zinc-400 dark:text-zinc-500">
          <button onClick={() => onOpenLegal('privacy')} className="transition-colors duration-300 hover:text-zinc-900 dark:hover:text-zinc-50">Privacy</button>
          <button onClick={() => onOpenLegal('manifesto')} className="transition-colors duration-300 hover:text-zinc-900 dark:hover:text-zinc-50">Manifesto</button>
          <button onClick={() => onOpenLegal('contact')} className="transition-colors duration-300 hover:text-zinc-900 dark:hover:text-zinc-50">Contact</button>
        </div>
      </div>
    </footer>
  )
}

/* ──────────────────────────────────────────────────────────────
   Archive Modal — glassmorphic full-memory overlay
   ────────────────────────────────────────────────────────────── */
function ArchiveModal({ open, onClose, memories, onFocusMemory }: { open: boolean; onClose: () => void; memories: MemoryRow[]; onFocusMemory: (id: string) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => closeRef.current?.focus(), 30)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); clearTimeout(t) }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="All memories" className="fixed inset-0 z-[100] flex items-center justify-center p-5">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-xl" />
      <div className="relative w-full max-w-2xl animate-[aether-modal-in_220ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="overflow-hidden rounded-[28px] border border-zinc-200/50 dark:border-zinc-800/60 bg-white/90 dark:bg-[#18181B]/90 backdrop-blur-xl shadow-[0_40px_120px_-20px_rgba(0,0,0,0.35)]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800/60 bg-white/90 dark:bg-[#18181B]/90 px-6 py-4 backdrop-blur-xl">
            <h2 className="font-display text-xl tracking-tight text-zinc-900 dark:text-zinc-50">Your full archive</h2>
            <button ref={closeRef} aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-all duration-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95"><X className="h-4 w-4" /></button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-6 py-5 aether-scroll">
            {memories.length === 0 ? <p className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">Your archive is clear.</p> : (
              <div className="space-y-3">
                {memories.map((m) => (
                  <button key={m.id} onClick={() => onFocusMemory(m.id)} className="block w-full rounded-xl border border-zinc-100 dark:border-zinc-800/60 bg-zinc-50/50 dark:bg-zinc-800/30 p-4 text-left transition-all duration-300 hover:border-purple-200 dark:hover:border-purple-500/30 hover:bg-purple-50/50 dark:hover:bg-purple-500/5 active:scale-[0.99]">
                    <div className="mb-1 flex items-center justify-between">
                      <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{m.title}</h4>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{timeAgo(m.created_at)}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400 line-clamp-3">{m.body?.replace(/\s*\[Image content:[\s\S]*?\]\s*/g, '').trim() || m.body}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes aether-modal-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>, document.body)
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
  const [askInitialImage, setAskInitialImage] = useState<string | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [legalType, setLegalType] = useState<'privacy' | 'manifesto' | 'contact' | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [userTier, setUserTier] = useState<string>('mist')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const user = useAuthStore((s) => s.user)
  const userId = user?.id
  const { queueCapture, checkOnline } = useOfflineQueue()

  // Restore session on mount — works ONLINE (Supabase refresh) and
  // OFFLINE (falls back to localStorage cached session).
  useEffect(() => {
    initTheme()

    // Offline-first: check localStorage for a cached session before
    // hitting the network. This ensures the user stays "signed in"
    // even when offline.
    try {
      const cached = localStorage.getItem('sb-' + (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/https?:\/\/|\..*/g, '') + '-auth-token')
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed?.user) {
          useAuthStore.getState().setSession(parsed)
        }
      }
    } catch {}

    // Online: try the real Supabase session (refreshes token if needed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) useAuthStore.getState().setSession(session)
    }).catch(() => {})

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      useAuthStore.getState().setSession(session)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])

  // Fetch the user's tier on sign-in (for the pre-flight premium gate).
  useEffect(() => {
    if (!userId) { setUserTier('mist'); return }
    let active = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active || !session?.user) return
      fetch('/api/tier', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(d => { if (active && d.success) setUserTier(d.tier) })
        .catch(() => {})
    })
    return () => { active = false }
  }, [userId])

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

      // Offline check: queue if no connection, show optimistic card
      if (!checkOnline()) {
        queueCapture(trimmed)
        const tempId = `temp-${crypto.randomUUID()}`
        const optimistic: MemoryRow = {
          id: tempId, title: 'Saved offline', body: trimmed, summary: null,
          category: 'idea', tags: ['capture', 'offline'], processing: false,
          user_id: null, metadata: null, created_at: new Date().toISOString(),
        }
        setMemories((prev) => [optimistic, ...prev])
        return
      }

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
          setTimeout(() => void refetch(), 2000)
          setTimeout(() => void refetch(), 4000)
          setTimeout(() => void refetch(), 7000)
          setTimeout(() => void refetch(), 12000)
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
    [refetch, checkOnline, queueCapture]
  )

  // Capture with an image — sends the image base64 to the server, which
  // analyzes it with the VLM and enriches the memory with its content.
  const addMemoryWithImage = useCallback(
    (text: string, image: string) => {
      // Offline check: queue if no connection
      if (!checkOnline()) {
        queueCapture(text, image)
        const tempId = `temp-${crypto.randomUUID()}`
        const optimistic: MemoryRow = {
          id: tempId, title: 'Saved offline', body: text || 'Image capture', summary: null,
          category: 'image', tags: ['capture', 'offline'], processing: false,
          user_id: null, metadata: { imageData: image }, created_at: new Date().toISOString(),
        }
        setMemories((prev) => [optimistic, ...prev])
        return
      }

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
          setTimeout(() => void refetch(), 3000)
          setTimeout(() => void refetch(), 6000)
          setTimeout(() => void refetch(), 10000)
          setTimeout(() => void refetch(), 15000)
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
    [refetch, checkOnline, queueCapture]
  )

  // Capture with a voice note — sends the audio base64 so the user can
  // play it back later by pressing the memory card.
  const addMemoryWithAudio = useCallback(
    (text: string, audio: string) => {
      // Offline check: queue if no connection
      if (!checkOnline()) {
        queueCapture(text, undefined, audio)
        const tempId = `temp-${crypto.randomUUID()}`
        const optimistic: MemoryRow = {
          id: tempId, title: 'Saved offline', body: text, summary: null,
          category: 'note', tags: ['capture', 'offline', 'voice'], processing: false,
          user_id: null, metadata: { audioData: audio }, created_at: new Date().toISOString(),
        }
        setMemories((prev) => [optimistic, ...prev])
        return
      }

      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: MemoryRow = {
        id: tempId,
        title: 'Capturing voice note…',
        body: text,
        summary: null,
        category: 'note',
        tags: ['capture', 'voice'],
        processing: true,
        user_id: null,
        metadata: { audioData: audio },
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
            body: JSON.stringify({ content: text, audio }),
          })
          const json = (await res.json()) as { success?: boolean; id?: string; error?: string }
          if (!res.ok || !json.success) throw new Error(json.error || 'Could not capture that voice note.')
          const realId = json.id as string
          setMemories((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: realId, user_id: session.user.id } : m)))
          toast.success('Voice note captured.', { description: 'Aether is transcribing it in the background.' })
          setTimeout(() => void refetch(), 2000)
          setTimeout(() => void refetch(), 4000)
          setTimeout(() => void refetch(), 7000)
          setTimeout(() => void refetch(), 12000)
        } catch (err) {
          setMemories((prev) => prev.filter((m) => m.id !== tempId))
          toast.error(err instanceof Error ? err.message : 'Could not capture that voice note.')
        }
      })()
    },
    [refetch, checkOnline, queueCapture]
  )
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

  // Filter memories by the active folder category (not tags).
  // Tags are invisible — they power search but folders use the category column.
  const visibleMemories = useMemo(
    () =>
      activeFolder === null
        ? memories
        : memories.filter((m) => {
            const cat = (m.category || 'others').toLowerCase().trim()
            const allowed = ['work', 'books', 'ideas', 'food', 'entertainment', 'others']
            const normalized = allowed.includes(cat) ? cat : 'others'
            return normalized === activeFolder
          }),
    [memories, activeFolder]
  )

  return (
    <ErrorBoundary>
    <div className="relative flex min-h-screen flex-col overscroll-y-contain">
      <TheGlow />
      <TopRail onOpenAsk={() => setAskOpen(true)} onOpenProfile={() => setProfileOpen(true)} />

      <main className="flex flex-1 flex-col gap-20 px-0 pb-40 pt-28 sm:pt-40">
        <HeroGreeting />
        <RecapBlock onReadRecap={() => ensureAuthenticated(() => setRecapOpen(true))} />
        <Collections memories={memories} activeFolder={activeFolder} onSelectFolder={setActiveFolder} />
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
          onAskAboutImage={(image) => { setAskInitialImage(image); setAskOpen(true) }}
          onViewAll={() => setArchiveOpen(true)}
        />
      </main>

      <Footer onOpenLegal={setLegalType} />

      <FloatingCapsule onCapture={addMemory} onCaptureWithImage={addMemoryWithImage} onCaptureWithAudio={addMemoryWithAudio} userTier={userTier} onUpgrade={() => setUpgradeOpen(true)} />

      <AuthModal />
      <RecapModal open={recapOpen} onClose={() => setRecapOpen(false)} />
      <InsightModal open={insightOpen} memoryId={insightMemory?.id ?? null} memoryTitle={insightMemory?.title ?? ''} onClose={() => setInsightOpen(false)} />
      <AskAetherModal key={askInitialImage ?? 'none'} open={askOpen} memories={memories} initialImage={askInitialImage} onClose={() => { setAskOpen(false); setAskInitialImage(null) }} onFocusMemory={(id) => { setActiveFolder(null); setHighlightId(id); setTimeout(() => setHighlightId((c) => c === id ? null : c), 4000); setTimeout(() => { const el = document.getElementById(`memory-${id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100); }} />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} onUpgrade={() => { setProfileOpen(false); setUpgradeOpen(true) }} />
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      <ArchiveModal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        memories={memories}
        onFocusMemory={(id) => {
          setArchiveOpen(false)
          setActiveFolder(null)
          setHighlightId(id)
          setTimeout(() => setHighlightId((c) => c === id ? null : c), 4000)
          setTimeout(() => { const el = document.getElementById(`memory-${id}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 200)
        }}
      />
      <LegalModal type={legalType} onClose={() => setLegalType(null)} />

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
    </ErrorBoundary>
  )
}
