/**
 * Aether · dev-only logger
 * ------------------------------------------------------------
 * All console output is suppressed in production so the deployment
 * ships with a perfectly clean console — no warnings, no info logs,
 * no development fallback banners.
 */

const isDev = process.env.NODE_ENV !== 'production'

export const logger = {
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args)
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info(...args)
  },
  error: (...args: unknown[]) => {
    if (isDev) console.error(...args)
  },
}
