'use client'

/**
 * Aether · VoiceWaveform
 * ------------------------------------------------------------
 * Native-feeling waveform visualizer with two states:
 *
 * A. LIVE RECORDING — 24 vertical bars driven by real-time frequency
 *    data from useVoiceRecorder's analyser (fftSize=64 → 32 bins).
 *    Bars map directly to mic amplitude, updating every animation frame.
 *
 * B. SAVED REPLAY — static waveform summary with progressive playhead
 *    tinting. Bars shift from zinc-300 → purple-500 left-to-right as
 *    the audio plays (WhatsApp-style). Uses an invisible Audio element
 *    + requestAnimationFrame to track currentTime / duration.
 *
 * No standard HTML <audio> controls. All canvas/SVG-style rendering.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'

type LiveWaveformProps = {
  frequencyData: Uint8Array
  barCount?: number
}

/** State A — Live recording waveform driven by real-time frequency data. */
export function LiveWaveform({ frequencyData, barCount = 24 }: LiveWaveformProps) {
  // Map the 32-bin frequency data to barCount bars by even spacing.
  const bars = useMemo(() => {
    const result: number[] = []
    const binCount = frequencyData.length || 32
    for (let i = 0; i < barCount; i++) {
      // Sample bins evenly, favoring lower bins (where speech lives)
      const idx = Math.floor((i / barCount) * binCount * 0.7)
      const raw = frequencyData[idx] ?? 0
      // Normalize 0-255 → 15%-100% height
      const normalized = 15 + (raw / 255) * 85
      result.push(normalized)
    }
    return result
  }, [frequencyData, barCount])

  return (
    <div className="flex h-8 flex-1 items-center gap-[2px]" aria-hidden>
      {bars.map((height, i) => (
        <div
          key={i}
          className="flex-1 rounded-full bg-purple-500/80 dark:bg-purple-400/90"
          style={{
            height: `${height}%`,
            transition: 'height 75ms ease-out',
            minWidth: '2px',
          }}
        />
      ))}
    </div>
  )
}

type ReplayWaveformProps = {
  audioData: string
  barCount?: number
}

/** State B — Saved replay waveform with progressive playhead tinting. */
export function ReplayWaveform({ audioData, barCount = 28 }: ReplayWaveformProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0 → 1

  // Generate a deterministic static waveform shape from the audio data URL.
  // This gives each voice note a unique but stable visual fingerprint.
  const staticBars = useMemo(() => {
    // Hash the audio data URL to seed the shape
    let seed = 0
    for (let i = 0; i < Math.min(audioData.length, 500); i++) {
      seed = (seed * 31 + audioData.charCodeAt(i)) >>> 0
    }
    const bars: number[] = []
    for (let i = 0; i < barCount; i++) {
      // Pseudo-random height with a speech-like envelope (taller in the middle)
      const noise = (Math.sin(seed + i * 0.7) * 10000) % 1
      const envelope = Math.sin((i / barCount) * Math.PI) // 0→1→0 arc
      const base = 20 + Math.abs(noise) * 50
      const height = base * (0.5 + envelope * 0.5)
      bars.push(Math.min(100, Math.max(15, height)))
    }
    return bars
  }, [audioData, barCount])

  // Track playback progress via requestAnimationFrame
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }
    const tick = () => {
      const audio = audioRef.current
      if (audio && audio.duration > 0) {
        setProgress(audio.currentTime / audio.duration)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [playing])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      // If at end, restart
      if (audio.currentTime >= audio.duration) {
        audio.currentTime = 0
        setProgress(0)
      }
      audio.play()
      setPlaying(true)
    }
  }

  const handleEnded = () => {
    setPlaying(false)
    setProgress(0)
  }

  // Determine how many bars are "active" based on progress
  const activeCount = Math.floor(progress * barCount)

  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-200/50 dark:border-zinc-800/60 bg-zinc-50/40 dark:bg-zinc-800/30 p-3 transition-all duration-300 hover:border-purple-200 dark:hover:border-purple-500/30 hover:bg-purple-50/30 dark:hover:bg-purple-500/5">
      <audio ref={audioRef} src={audioData} onEnded={handleEnded} preload="metadata" className="hidden" />
      <button
        onClick={toggle}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-500 text-white transition-all duration-300 hover:bg-purple-600 hover:scale-105 active:scale-95"
      >
        {playing ? (
          <span className="flex gap-0.5">
            <span className="h-3 w-0.5 rounded-full bg-white" />
            <span className="h-3 w-0.5 rounded-full bg-white" />
          </span>
        ) : (
          <Play className="h-4 w-4 fill-current" />
        )}
      </button>
      {/* Progressive playhead waveform */}
      <div className="flex h-8 flex-1 items-center gap-[2px]">
        {staticBars.map((height, i) => {
          const isActive = i < activeCount
          return (
            <div
              key={i}
              className={`flex-1 rounded-full transition-colors duration-150 ${
                isActive
                  ? 'bg-purple-500 dark:bg-purple-400'
                  : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
              style={{ height: `${height}%`, minWidth: '2px' }}
            />
          )
        })}
      </div>
      <span className="shrink-0 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
        {playing ? 'Playing…' : 'Voice note'}
      </span>
    </div>
  )
}
