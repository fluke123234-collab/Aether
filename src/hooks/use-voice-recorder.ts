'use client'

/**
 * Aether · useVoiceRecorder
 * ------------------------------------------------------------
 * Native Web Audio recording + real-time frequency analysis.
 *
 * Engine:
 *  - navigator.mediaDevices.getUserMedia → MediaStream
 *  - MediaRecorder → compressed audio/webm blob (for playback + storage)
 *  - AudioContext + AnalyserNode (fftSize=64) → live frequency data array
 *
 * Outputs:
 *  - listening: boolean (recording active)
 *  - frequencyData: Uint8Array(32) — real-time mic amplitude per bin
 *  - audioData: string | null — base64 data URL of the recorded blob
 *  - start() / stop()
 *
 * The frequencyData array drives the live VoiceWaveform canvas.
 * Designed to be entirely encapsulated — no global state leakage.
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

  // ── RAF loop: poll analyser frequency data and push to state ──
  const startFrequencyLoop = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    const buffer = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(buffer)
      // Copy to a new array so React detects the state change
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
    // Reset state
    setAudioData(null)
    audioChunksRef.current = []

    try {
      // Down-sample to 16kHz mono for 70% smaller payloads while keeping
      // word-for-word accuracy crisp for Gemini's voice recognition
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      })
      streamRef.current = stream

      // ── MediaRecorder for blob capture ──
      const mr = new MediaRecorder(stream, {
        audioBitsPerSecond: 16000, // 16kbps — tiny but clear for speech
      })
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const reader = new FileReader()
        reader.onload = () => setAudioData(reader.result as string)
        reader.readAsDataURL(blob)
      }
      mr.start()
      mediaRecorderRef.current = mr

      // ── AudioContext + AnalyserNode for real-time frequency data ──
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC()
      audioContextRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64          // 32 bins — perfect for a 24-28 bar visualizer
      analyser.smoothingTimeConstant = 0.75
      analyserRef.current = analyser
      source.connect(analyser)
      // Note: analyser is NOT connected to destination — no feedback/echo

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
    try { mediaRecorderRef.current?.stop() } catch {}
    // Cleanup audio context + tracks after a short delay (let onstop fire)
    setTimeout(() => cleanup(), 200)
  }, [stopFrequencyLoop, cleanup])

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup()
  }, [cleanup])

  return { listening, supported, start, stop, audioData, frequencyData }
}
