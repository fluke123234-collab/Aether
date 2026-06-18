'use client'

/**
 * Aether · useVoiceCapture
 * ------------------------------------------------------------
 * Web Speech API wrapper for the mic button. Transcribes speech in
 * real-time and returns the transcript. Falls back gracefully on
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
  const recRef = useRef<SpeechRecognitionLike | null>(null)

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
          if (result.isFinal) {
            finalText += transcript
          } else {
            interim += transcript
          }
        }
        const combined = (finalText + ' ' + interim).trim()
        if (combined) onTranscript(combined)
      }
      rec.onerror = () => setListening(false)
      rec.onend = () => setListening(false)

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
    setListening(false)
  }, [])

  return { listening, supported, start, stop }
}
