/**
 * Aether · Global auth store + reusable guard
 * ------------------------------------------------------------
 * Wraps Supabase Auth instead of mocking a session. The `user` is derived
 * from the real Supabase session ({ id, email }). A top-level listener
 * (set up in page.tsx) calls supabase.auth.onAuthStateChange to keep this
 * store in sync with the real session, so refreshing the page restores it.
 *
 * `ensureAuthenticated` is the single reusable interceptor: every core
 * interaction wraps its callback in it. A signed-out user never reaches
 * the action — the premium auth modal intercepts instantly instead.
 */

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type AetherUser = {
  id: string
  email: string
} | null

type AuthResult = { error: string | null; session: Session | null }

type AuthState = {
  user: AetherUser
  authModalOpen: boolean
  openModal: () => void
  closeModal: () => void
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
  /** Internal: called by the onAuthStateChange listener to sync the store. */
  setSession: (session: Session | null) => void
}

function userFromSession(session: Session | null): AetherUser {
  const u = session?.user
  if (!u) return null
  return { id: u.id, email: u.email ?? '' }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  authModalOpen: false,
  openModal: () => set({ authModalOpen: true }),
  closeModal: () => set({ authModalOpen: false }),
  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message, session: null }
    set({ user: userFromSession(data.session), authModalOpen: false })
    return { error: null, session: data.session }
  },
  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: error.message, session: null }
    if (data.session) {
      set({ user: userFromSession(data.session), authModalOpen: false })
    }
    return { error: null, session: data.session }
  },
  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null })
  },
  setSession: (session) => set({ user: userFromSession(session) }),
}))

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
