'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Moon, Sun, Bell, BellOff, Download, Trash2, LogOut, User, Crown, ChevronRight, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { useThemeStore } from '@/lib/theme-store'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export function ProfileModal({ open, onClose, onUpgrade }: { open: boolean; onClose: () => void; onUpgrade?: () => void }) {
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const [name, setName] = useState('')
  const [notifications, setNotifications] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tierInfo, setTierInfo] = useState<{ tier: string; usageCount: number; limit: number; remaining: number } | null>(() => {
    // INSTANT: load cached tier from localStorage (works offline)
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('aether-user-tier')
      if (cached) return { tier: cached.toLowerCase(), usageCount: 0, limit: 0, remaining: 0 }
    }
    return null
  })
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    if (user?.email) setName(user.email.split('@')[0] || '')
    const notifPref = localStorage.getItem('aether-recap-notif')
    setNotifications(notifPref === 'true')
    // Fetch tier + usage stats (syncs cache)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return
      fetch('/api/tier', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            const tier = (d.tier || 'mist').toLowerCase()
            setTierInfo({ tier, usageCount: d.usageCount, limit: d.limit, remaining: d.remaining })
            if (typeof window !== 'undefined') localStorage.setItem('aether-user-tier', tier)
          }
        })
        .catch(() => {})
    })
    const t = setTimeout(() => closeRef.current?.focus(), 30)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open, onClose, user])

  if (!open) return null

  const handleManageSubscription = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { toast.error('Please sign in.'); return }
      toast('Opening billing portal…')
      const res = await fetch('/api/stripe-portal', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else toast.error('Could not open billing portal.')
    } catch { toast.error('Could not open billing portal.') }
  }

  const handleToggleNotifications = async () => {
    const next = !notifications; setNotifications(next)
    localStorage.setItem('aether-recap-notif', String(next))
    if (next && typeof window !== 'undefined' && 'Notification' in window) {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { toast.error('Notifications blocked.', { description: 'Enable them in your browser settings.' }); setNotifications(false); localStorage.setItem('aether-recap-notif', 'false'); return }
      toast.success('Daily recap notifications on.', { description: 'You will get a gentle nudge each evening.' })
    } else if (!next) { toast('Notifications paused.') }
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { toast.error('Please sign in to export.'); setExporting(false); return }
      const res = await fetch('/api/export', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } })
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob(); const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `aether-sanctuary-${new Date().toISOString().split('T')[0]}.pdf`
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      toast.success('Sanctuary exported.', { description: 'Your thoughts are saved as a PDF book.' })
    } catch { toast.error('Could not export right now.') }
    setExporting(false)
  }

  const handleDeleteAccount = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      await supabase.from('memories').delete().eq('user_id', session.user.id)
      await signOut()
      toast.success('Your memories have been cleared.', { description: 'To fully delete your account, also remove it from Supabase → Authentication → Users.' })
      onClose()
    } catch { toast.error('Could not delete. Please try again.') }
  }

  const handleSignOut = async () => { await signOut(); onClose(); toast('Signed out.', { description: 'Until next time.' }) }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Profile and settings" className="fixed inset-0 z-[100] flex items-center justify-center p-5">
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-md" />
      <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto aether-scroll animate-[aether-modal-in_220ms_cubic-bezier(0.16,1,0.3,1)] rounded-[28px] border border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#27272A]/80 dark:backdrop-blur-md shadow-[0_40px_120px_-20px_rgba(0,0,0,0.35)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200/50 dark:border-zinc-800/60 bg-white/90 dark:bg-[#27272A]/80 px-6 py-4 backdrop-blur-xl">
          <h2 className="font-display text-xl tracking-tight text-zinc-900 dark:text-zinc-50">Profile</h2>
          <button ref={closeRef} aria-label="Close" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 dark:text-zinc-500 transition-all duration-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-6 space-y-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-500 text-lg font-semibold text-white shadow-[0_4px_16px_rgba(139,92,246,0.3)]">{(name || user?.email || '?').charAt(0).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => localStorage.setItem('aether-display-name', name)} className="w-full bg-transparent text-base font-medium text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-0" placeholder="Your name" />
              <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-zinc-200/50 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3">
            <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500"><Crown className="h-4 w-4" /></div><div><p className="text-sm font-medium capitalize text-zinc-700 dark:text-zinc-300">{tierInfo?.tier || 'mist'} plan</p><p className="text-xs text-zinc-400 dark:text-zinc-500">{tierInfo?.tier === 'presence' ? 'Unlimited AI captures' : tierInfo?.tier === 'echo' ? '100 AI captures / month' : 'Text-only — upgrade for AI captures'}</p></div></div>
            {tierInfo?.tier && tierInfo.tier !== 'mist' ? (
              <button onClick={handleManageSubscription} className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition-all duration-300 hover:scale-105 active:scale-95">Manage</button>
            ) : (
              <button onClick={onUpgrade} className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-medium text-white transition-all duration-300 hover:scale-105 active:scale-95">Upgrade</button>
            )}
          </div>
          {tierInfo?.tier && tierInfo.tier !== 'mist' && (
            <div className="-mt-3 flex justify-end">
              <button onClick={onUpgrade} className="text-[10px] font-medium text-purple-500 hover:text-purple-600 transition-colors">Upgrade to Presence →</button>
            </div>
          )}
          <div className="space-y-1">
            <SettingsRow icon={theme === 'dark' ? Moon : Sun} label="Dark mode" onClick={toggleTheme} right={<Toggle on={theme === 'dark'} />} />
            <SettingsRow icon={notifications ? Bell : BellOff} label="Daily recap notification" onClick={handleToggleNotifications} right={<Toggle on={notifications} />} />
            <SettingsRow icon={Download} label="Export sanctuary as PDF" onClick={handleExport} right={exporting ? <Loader2 className="h-4 w-4 animate-spin text-zinc-400 dark:text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-300" />} />
          </div>
          <div className="space-y-1 border-t border-zinc-200/50 dark:border-zinc-800/60 pt-4">
            <SettingsRow icon={LogOut} label="Sign out" onClick={handleSignOut} right={<ChevronRight className="h-4 w-4 text-zinc-300" />} />
            {confirmDelete ? (
              <div className="flex items-center gap-2 rounded-2xl bg-rose-50 p-3"><p className="flex-1 text-xs text-rose-600">Delete all your memories? This cannot be undone.</p><button onClick={handleDeleteAccount} className="rounded-full bg-rose-500 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-rose-600 active:scale-95">Delete</button><button onClick={() => setConfirmDelete(false)} className="rounded-full px-3 py-1.5 text-xs font-medium text-rose-400 transition-all hover:bg-rose-100 active:scale-95">Cancel</button></div>
            ) : <SettingsRow icon={Trash2} label="Delete account" onClick={() => setConfirmDelete(true)} right={<ChevronRight className="h-4 w-4 text-rose-300" />} danger />}
          </div>
        </div>
      </div>
      <style>{`@keyframes aether-modal-in { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
    </div>, document.body)
}

function SettingsRow({ icon: Icon, label, onClick, right, danger = false }: { icon: typeof User; label: string; onClick: () => void; right: React.ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all duration-300 hover:bg-zinc-50 dark:bg-zinc-800/50 active:scale-[0.98] ${danger ? 'text-rose-500' : 'text-zinc-700 dark:text-zinc-300'}`}>
      <Icon className={`h-4 w-4 ${danger ? 'text-rose-400' : 'text-zinc-400 dark:text-zinc-500'}`} /><span className="flex-1 text-sm font-medium">{label}</span>{right}
    </button>
  )
}

function Toggle({ on }: { on: boolean }) {
  return (<div className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${on ? 'bg-purple-500' : 'bg-zinc-200'}`}><div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white  shadow-sm transition-transform duration-300 ${on ? 'translate-x-5' : 'translate-x-0.5'}`} /></div>)
}
