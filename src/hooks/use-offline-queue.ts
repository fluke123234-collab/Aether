/**
 * Aether · useOfflineQueue — queue captures when offline, replay on reconnect
 */

'use client'

import { useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'

type QueuedCapture = {
  id: string
  content?: string
  image?: string
  audio?: string
  timestamp: number
}

const QUEUE_KEY = 'aether-offline-queue'

function getQueue(): QueuedCapture[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}

function setQueue(queue: QueuedCapture[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function useOfflineQueue() {
  const isOnline = useRef(true)

  useEffect(() => {
    isOnline.current = navigator.onLine
    const onOnline = () => { isOnline.current = true; flushQueue() }
    const onOffline = () => { isOnline.current = false }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    if (navigator.onLine) flushQueue()
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  const flushQueue = useCallback(async () => {
    const queue = getQueue()
    if (queue.length === 0) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    toast(`Syncing ${queue.length} offline capture${queue.length > 1 ? 's' : ''}…`, { description: 'Reconnecting to your sanctuary.' })
    const failed: QueuedCapture[] = []
    for (const item of queue) {
      try {
        const res = await fetch('/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ content: item.content, image: item.image, audio: item.audio }),
        })
        if (!res.ok) throw new Error('capture failed')
      } catch { failed.push(item) }
    }
    setQueue(failed)
    if (failed.length === 0) toast.success('All offline captures synced.', { description: 'Your sanctuary is up to date.' })
  }, [])

  const queueCapture = useCallback((content?: string, image?: string, audio?: string): boolean => {
    if (typeof window !== 'undefined' && !navigator.onLine) {
      const queue = getQueue()
      queue.push({ id: `offline-${Date.now()}`, content, image, audio, timestamp: Date.now() })
      setQueue(queue)
      toast('Saved offline.', { description: 'Your thought will sync when you reconnect.' })
      return true
    }
    return false
  }, [])

  const checkOnline = useCallback((): boolean => typeof window !== 'undefined' ? navigator.onLine : true, [])

  return { queueCapture, checkOnline, isOnline: isOnline }
}
