/**
 * Aether · Phase 4 — Global auth store + reusable guard
 * ------------------------------------------------------------
 * A lightweight Zustand store holding the session + auth-modal state.
 * `ensureAuthenticated` is the single reusable interceptor: every core
 * interaction (capture, search, favorites, recap, deep insights) wraps its
 * callback in it. A signed-out user never reaches the action — the premium
 * auth modal intercepts instantly instead.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AetherUser = {
  email: string
  name: string
} | null

type AuthState = {
  user: AetherUser
  authModalOpen: boolean
  openModal: () => void
  closeModal: () => void
  signIn: (email: string, name?: string) => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      authModalOpen: false,
      openModal: () => set({ authModalOpen: true }),
      closeModal: () => set({ authModalOpen: false }),
      signIn: (email, name) =>
        set({
          user: { email, name: name?.trim() || email.split('@')[0] || 'Friend' },
          authModalOpen: false,
        }),
      signOut: () => set({ user: null }),
    }),
    {
      name: 'aether-auth',
      // Persist only the session — never the modal flag (so a refresh never
      // re-pops the auth modal) — and skip automatic hydration so the first
      // client render matches the server (no hydration mismatch).
      partialize: (s) => ({ user: s.user }) as AuthState,
      skipHydration: true,
    }
  )
)

/**
 * Reusable global guard interceptor.
 * Returns true if the action ran, false if it was intercepted.
 *
 *   onClick={() => ensureAuthenticated(() => handleToggleFavorite(id))}
 */
export function ensureAuthenticated(actionCallback: () => void): boolean {
  const { user, openModal } = useAuthStore.getState()
  if (!user) {
    openModal()
    return false
  }
  actionCallback()
  return true
}
