'use client'

/**
 * Aether · ErrorBoundary — global fallback for unhandled exceptions
 * ------------------------------------------------------------
 * Catches any unhandled error in the React tree and replaces the
 * broken widget with a calm, minimal message instead of a white
 * screen of death. The user can retry without losing the page.
 */

import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Silently log — never break the console experience
    console.warn('Aether · caught error boundary:', error.message, errorInfo.componentStack?.slice(0, 100))
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#FCFBF9] px-5 dark:bg-[#09090B]">
          <div className="text-center">
            <div className="mx-auto mb-6 h-16 w-16 animate-pulse rounded-full bg-gradient-to-br from-purple-400/30 to-blue-400/20 blur-xl" />
            <h1 className="font-display text-2xl tracking-tight text-zinc-900 dark:text-zinc-50">
              Aether is breathing.
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Reconnecting to your sanctuary…
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-all duration-300 hover:scale-105 active:scale-95 dark:bg-white dark:text-zinc-900"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
