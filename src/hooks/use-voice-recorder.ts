'use client'

/**
 * Aether · useVoiceRecorder — Persistent stream recorder
 * ------------------------------------------------------------
 * Uses MediaRecorder with continuous time-slice (250ms) to prevent
 * premature dropouts from silence detection or mobile background
 * thread switches. The stream stays open until the user manually
 * hits stop.
 *
 * Engine:
 *  - getUserMedia → persistent MediaStream (stays open)
 *  - MediaRecorder.start(250) → continuous chunk appending
 *  - AudioContext + AnalyserNode (fftSize=64) → live waveform
 *
 * The 250ms time-slice forces ondataavailable to fire every 250ms,
 * keeping the recorder alive even during silence pauses.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export function useVoiceRecorder() {
  const [listening, setListening] = useState(false)
  const [audioData, setAudioData] = useState<string | null>(null)
  const [frequencyData, setFrequencyData] = useState<Uint8Array>(new Uint8Array(32))

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const [supported] = useState(() => {
    if (typeof window === 'undefined') return false
    return !!(
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined' &&
      typeof window.AudioContext !== 'undefined'
    )
  })

  // ── RAF loop: poll analyser frequency data ──
  const startFrequencyLoop = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    const buffer = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(buffer)
      setFrequencyData(new Uint8Array(buffer))
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  const stopFrequencyLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const cleanup = useCallback(() => {
    stopFrequencyLoop()
    if (sourceRef.current) {
      try { sourceRef.current.disconnect() } catch {}
      sourceRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try { audioContextRef.current.close() } catch {}
    }
    audioContextRef.current = null
    analyserRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [stopFrequencyLoop])

  const start = useCallback(async (): Promise<boolean> => {
    if (!supported) return false
    setAudioData(null)
    audioChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      })
      streamRef.current = stream

      // ── Pick the best supported codec ──
      let mimeType = 'audio/webm;codecs=opus'
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : ''
        }
      }

      // ── MediaRecorder with continuous time-slice (250ms) ──
      // The 250ms slice forces ondataavailable to fire every 250ms,
      // keeping the recorder alive even during silence pauses.
      // This prevents the "stops suddenly" bug on mobile.
      const mr = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        audioBitsPerSecond: 16000,
      })

      mr.ondataavailable = (e) => {
        // Continuously append chunks — never drop data
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data)
        }
      }

      mr.onstop = () => {
        // Assemble ALL accumulated chunks into one blob
        if (audioChunksRef.current.length === 0) return
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onload = () => setAudioData(reader.result as string)
        reader.readAsDataURL(blob)
      }

      // Start with 250ms time-slice — continuous streaming, no auto-stop
      mr.start(250)
      mediaRecorderRef.current = mr

      // ── AudioContext + AnalyserNode for live waveform ──
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.75
      analyserRef.current = analyser
      source.connect(analyser)

      setListening(true)
      startFrequencyLoop()
      return true
    } catch {
      setListening(false)
      cleanup()
      return false
    }
  }, [supported, cleanup, startFrequencyLoop])

  const stop = useCallback(() => {
    setListening(false)
    stopFrequencyLoop()

    // Stop the MediaRecorder — this triggers onstop which assembles the blob
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        // Request any remaining data before stopping
        mediaRecorderRef.current.requestData()
        mediaRecorderRef.current.stop()
      } catch {}
    }

    // Cleanup after onstop has time to fire
    setTimeout(() => cleanup(), 300)
  }, [stopFrequencyLoop, cleanup])

  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  return { listening, supported, start, stop, audioData, frequencyData }
}
