'use client'

/**
 * Aether · useVoiceCapture
 * ------------------------------------------------------------
 * Web Speech API wrapper for the mic button. Transcribes speech in
 * real-time AND records audio via MediaRecorder so the user can
 * play back their voice note later. Falls back gracefully on
 * unsupported browsers.
 */

import { useCallback, useRef, useState } from 'react'

type SpeechRecognitionResult = {
  transcript: string
  isFinal: boolean
}
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<SpeechRecognitionResult>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

export function useVoiceCapture() {
  const [listening, setListening] = useState(false)
  const [audioData, setAudioData] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const [supported] = useState(() => {
    if (typeof window === 'undefined') return true
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition)
  })

  const start = useCallback(
    (onTranscript: (text: string) => void) => {
      const w = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike
        webkitSpeechRecognition?: new () => SpeechRecognitionLike
      }
      const SR = w.SpeechRecognition || w.webkitSpeechRecognition
      if (!SR) return false

      // Reset audio data
      setAudioData(null)
      audioChunksRef.current = []

      // Start audio recording via MediaRecorder (for playback later)
      try {
        navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
          streamRef.current = stream
          const mr = new MediaRecorder(stream)
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data)
          }
          mr.onstop = () => {
            const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
            const reader = new FileReader()
            reader.onload = () => setAudioData(reader.result as string)
            reader.readAsDataURL(blob)
            // Stop all tracks
            stream.getTracks().forEach((t) => t.stop())
          }
          mr.start()
          mediaRecorderRef.current = mr
        }).catch(() => {
          // Microphone permission denied — speech recognition still works
        })
      } catch {
        // MediaRecorder not available — speech recognition still works
      }

      // Start speech recognition
      const rec = new SR()
      rec.lang = 'en-US'
      rec.interimResults = true
      rec.continuous = true

      let finalText = ''
      rec.onresult = (event) => {
        let interim = ''
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i]
          const transcript = result[0].transcript
          if (result.isFinal) finalText += transcript
          else interim += transcript
        }
        const combined = (finalText + ' ' + interim).trim()
        if (combined) onTranscript(combined)
      }
      rec.onerror = () => {
        setListening(false)
        try { mediaRecorderRef.current?.stop() } catch {}
      }
      rec.onend = () => {
        setListening(false)
        try { mediaRecorderRef.current?.stop() } catch {}
      }

      recRef.current = rec
      try {
        rec.start()
        setListening(true)
        return true
      } catch {
        setListening(false)
        return false
      }
    },
    []
  )

  const stop = useCallback(() => {
    recRef.current?.stop()
    try { mediaRecorderRef.current?.stop() } catch {}
    setListening(false)
  }, [])

  return { listening, supported, start, stop, audioData }
}
