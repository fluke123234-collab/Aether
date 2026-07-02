/**
 * Aether · usePremiumEnforcer — instant synchronous client-side trial enforcement
 * ------------------------------------------------------------
 * Zero-lag interception: checks localStorage synchronously before
 * any async pipeline starts. No state delays, no API roundtrips.
 */

import { useState, useCallback, useEffect } from 'react'

const ALLOWED_FREE_ACTIONS = 3
const STORAGE_KEY = 'aether-free-actions'

export function usePremiumEnforcer(userTier: string) {
  // Initialize synchronously from localStorage — no async delay
  const [usageCount, setUsageCount] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    try { return parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) } catch { return 0 }
  })

  const isFreeTier = userTier === 'mist'

  // Synchronous instant check — called BEFORE any async pipeline
  const verifyActionInstant = useCallback((onSuccess: () => void, triggerPaywall: () => void): boolean => {
    // Paid users: instant pass
    if (!isFreeTier) { onSuccess(); return true }

    // Free user: check localStorage synchronously (not state — state may lag)
    const currentCount = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10)

    if (currentCount >= ALLOWED_FREE_ACTIONS) {
      // Instant paywall — zero delay
      triggerPaywall()
      return false
    }

    // Increment + persist synchronously
    const newCount = currentCount + 1
    localStorage.setItem(STORAGE_KEY, String(newCount))
    setUsageCount(newCount)

    // Proceed instantly
    onSuccess()
    return true
  }, [isFreeTier])

  const getRemaining = useCallback((): number => {
    if (!isFreeTier) return Infinity
    return Math.max(0, ALLOWED_FREE_ACTIONS - usageCount)
  }, [isFreeTier, usageCount])

  return { verifyActionInstant, getRemaining, usageCount, isFreeTier, ALLOWED_FREE_ACTIONS }
}
