'use client'

/**
 * Aether · Phase 4 — Premium auth modal
 * ------------------------------------------------------------
 * Mounts instantly (no slow fade lag) the moment `authModalOpen` flips true.
 * Deep, ultra-premium blurred backdrop freezes the workspace and isolates
 * focus strictly onto the auth fields. Escape / backdrop-click dismiss.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Mail, Lock, ArrowRight, Sparkles } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { toast } from 'sonner'

export function AuthModal() {
  const open = useAuthStore((s) => s.authModalOpen)
  const closeModal = useAuthStore((s) => s.closeModal)
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [busy, setBusy] = useState(false)

  const emailRef = useRef<HTMLInputElement>(null)

  // Instant focus + scroll lock the moment the modal opens.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => emailRef.current?.focus(), 30)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, closeModal])

  // `open` is only ever flipped true by a user click (post-mount), so
  // document.body always exists by the time we portal into it.
  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) {
      toast.error('Please enter your email.')
      emailRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      const { error, session } =
        mode === 'signin'
          ? await signIn(email.trim(), password)
          : await signUp(email.trim(), password)

      if (error) {
        toast.error(error)
        return
      }
      if (!session) {
        toast.success('Check your email.', {
          description: 'Confirm your address to complete sign-up.',
        })
        return
      }
      closeModal()
      setEmail('')
      setPassword('')
      toast.success('Welcome to Aether.', {
        description: 'The sanctuary is yours now.',
      })
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'signin' ? 'Sign in to Aether' : 'Create your Aether account'}
      className="fixed inset-0 z-[100] flex items-center justify-center p-5"
    >
      {/* Deep, ultra-premium blurred backdrop — freezes the workspace */}
      <div
        aria-hidden
        onClick={closeModal}
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
      />

      {/* Modal card — instant mount, a whisper-soft scale-in */}
      <div className="relative w-full max-w-md animate-[aether-modal-in_220ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="overflow-hidden rounded-[28px] border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#27272A]/80 dark:backdrop-blur-md shadow-[0_40px_120px_-20px_rgba(0,0,0,0.35)]">
          {/* velvet header glow */}
          <div className="pointer-events-none relative h-24 bg-gradient-to-br from-purple-600 via-purple-500 to-indigo-600">
            <div className="absolute -bottom-10 left-1/2 h-28 w-28 -translate-x-1/2 rounded-full bg-white/20 blur-2xl" />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 text-white">
              <Sparkles className="h-4 w-4" />
              <span className="font-display text-xl tracking-tight">Aether</span>
            </div>
            <button
              aria-label="Close"
              onClick={closeModal}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-all duration-200 hover:bg-white/30 hover:scale-105 active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-8 pb-8 pt-7">
            <h2 className="font-display text-2xl tracking-tight text-zinc-900 dark:text-zinc-50">
              {mode === 'signin' ? 'Welcome back' : 'Begin your sanctuary'}
            </h2>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-500">
              {mode === 'signin'
                ? 'Sign in to capture, recall, and reflect.'
                : 'Create an account to start keeping your thoughts.'}
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-3">
              {/* Email capsule */}
              <label className="group relative flex items-center rounded-full border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#18181B] pl-5 pr-2 shadow-[0_4px_20px_rgb(0,0,0,0.02)] focus-within:border-zinc-200 transition-all duration-300">
                <Mail className="pointer-events-none h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                <input
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@aether.app"
                  className="h-12 flex-1 bg-transparent px-3 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:text-zinc-500 focus:outline-none focus:ring-0"
                />
              </label>

              {/* Password capsule */}
              <label className="group relative flex items-center rounded-full border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#18181B] pl-5 pr-2 shadow-[0_4px_20px_rgb(0,0,0,0.02)] focus-within:border-zinc-200 transition-all duration-300">
                <Lock className="pointer-events-none h-4 w-4 text-zinc-400 dark:text-zinc-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 flex-1 bg-transparent px-3 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:text-zinc-500 focus:outline-none focus:ring-0"
                />
              </label>

              <button
                type="submit"
                disabled={busy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-zinc-900 text-sm font-medium text-white transition-all duration-300 hover:bg-purple-600 hover:scale-[1.01] active:scale-95 disabled:opacity-60"
              >
                {busy ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <>
                    {mode === 'signin' ? 'Sign in' : 'Create account'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                className="font-medium text-purple-600 transition-colors duration-200 hover:text-purple-700"
              >
                {mode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes aether-modal-in {
          from { opacity: 0; transform: translateY(8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>,
    document.body
  )
}
