/**
 * Aether · shared domain types
 * ------------------------------------------------------------
 * Centralised so components (Collections, page, etc.) share one
 * source of truth without circular imports.
 */

export type MemoryMetadata = {
  title?: string
  summary?: string
  tags?: string[]
  type?: string
  connections?: string[]
  imageDescription?: string
  searchKeywords?: string[]
  imageData?: string
  audioData?: string
} | null

export type MemoryRow = {
  id: string
  title: string
  body: string
  summary: string | null
  category: string | null
  tags: string[] | null
  metadata: MemoryMetadata
  processing: boolean | null
  user_id: string | null
  view_count?: number | null
  last_viewed_at?: string | null
  created_at: string
}
