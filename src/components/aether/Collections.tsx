'use client'

/**
 * Aether · Collections — 6-folder strict category system
 * ------------------------------------------------------------
 * Shows only the 6 allowed categories as folders.
 * Filters by the `category` column, not individual tags.
 * Tags remain invisible — they power search but never appear as folders.
 */

import { useMemo } from 'react'
import { Folder, FolderOpen, LayoutGrid, Briefcase, BookOpen, Lightbulb, UtensilsCrossed, Film, Sparkles, type LucideIcon } from 'lucide-react'
import type { MemoryRow } from '@/lib/types'

export type CollectionsProps = {
  memories: MemoryRow[]
  activeFolder: string | null
  onSelectFolder: (tag: string | null) => void
}

const ALLOWED_CATEGORIES = [
  { key: 'work', label: 'Work', icon: Briefcase },
  { key: 'books', label: 'Books', icon: BookOpen },
  { key: 'ideas', label: 'Ideas', icon: Lightbulb },
  { key: 'food', label: 'Food', icon: UtensilsCrossed },
  { key: 'entertainment', label: 'Entertainment', icon: Film },
  { key: 'others', label: 'Others', icon: Sparkles },
] as const

export function Collections({
  memories,
  activeFolder,
  onSelectFolder,
}: CollectionsProps) {
  // Count memories per category (only the 6 allowed buckets)
  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    for (const memory of memories) {
      const cat = (memory.category || 'others').toLowerCase().trim()
      // Normalize: if category isn't one of the 6, count as 'others'
      const allowed = ALLOWED_CATEGORIES.find(c => c.key === cat)
      const normalized = allowed ? cat : 'others'
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
    }
    return ALLOWED_CATEGORIES
      .map(c => ({ ...c, count: counts.get(c.key) ?? 0 }))
      .filter(c => c.count > 0) // Only show folders that have memories
  }, [memories])

  const totalCount = memories.length

  if (totalCount === 0) return null

  return (
    <section className="mx-auto w-full max-w-6xl px-5">
      <div className="mb-5 flex items-center gap-2.5">
        <Folder className="h-[18px] w-[18px] text-zinc-400 dark:text-zinc-500" />
        <h3 className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Collections</h3>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {folders.length} {folders.length === 1 ? 'folder' : 'folders'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {/* All memories — clears the filter */}
        <FolderPill
          icon={LayoutGrid}
          label="All"
          count={totalCount}
          active={activeFolder === null}
          onClick={() => onSelectFolder(null)}
        />

        {folders.map(({ key, label, icon, count }) => (
          <FolderPill
            key={key}
            icon={icon}
            label={label}
            count={count}
            active={activeFolder === key}
            onClick={() => onSelectFolder(activeFolder === key ? null : key)}
          />
        ))}
      </div>
    </section>
  )
}

/* ── A single folder pill — crisp, uniform, museum-grade ── */

function FolderPill({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`group inline-flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 active:scale-95 ${
        active
          ? 'border-purple-200 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 shadow-[0_4px_20px_rgba(139,92,246,0.08)] dark:shadow-none'
          : 'border-zinc-200/50 dark:border-zinc-800/60 bg-white dark:bg-[#18181B] text-zinc-600 dark:text-zinc-300 hover:border-zinc-200 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:-translate-y-0.5'
      }`}
    >
      <Icon
        className={`h-[18px] w-[18px] transition-colors duration-300 ${
          active
            ? 'text-purple-500'
            : 'text-zinc-400 dark:text-zinc-500 group-hover:text-purple-500'
        }`}
      />
      <span>{label}</span>
      <span
        className={`text-xs font-semibold tabular-nums transition-colors duration-300 ${
          active ? 'text-purple-400' : 'text-zinc-400 dark:text-zinc-500'
        }`}
      >
        {count}
      </span>
    </button>
  )
}
