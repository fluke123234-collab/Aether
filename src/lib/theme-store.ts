/**
 * Aether · Theme store
 * Light/dark mode with localStorage persistence + system preference.
 */
import { create } from 'zustand'

type Theme = 'light' | 'dark'

type ThemeState = {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

const STORAGE_KEY = 'aether-theme'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  if (theme === 'dark') document.body.classList.add('dark')
  else document.body.classList.remove('dark')
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
    set({ theme: next })
  },
  setTheme: (t) => {
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, t)
    applyTheme(t)
    set({ theme: t })
  },
}))

export function initTheme() {
  const theme = getInitialTheme()
  applyTheme(theme)
  useThemeStore.setState({ theme })
}
