/**
 * Aether · shared domain types
 * ------------------------------------------------------------
 * Centralised so components (Collections, page, etc.) share one
 * source of truth without circular imports.
 */

export type MemoryRow = {
  id: string
  title: string
  body: string
  summary: string | null
  category: string | null
  tags: string[] | null
  processing: boolean | null
  user_id: string | null
  created_at: string
}
