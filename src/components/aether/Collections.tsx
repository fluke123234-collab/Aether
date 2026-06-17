'use client'

/**
 * Aether · Phase 5 — Smart Folder Collection Engine
 * ------------------------------------------------------------
 * Dynamically reads active metadata tags from the live memories array
 * and compiles them into interactive folder categories. No hardcoded
 * text — folders appear and disappear as the database evolves.
 *
 * Clicking a folder filters the memory feed below to that exact tag.
 */

import { useMemo } from 'react'
import { Folder, FolderOpen, LayoutGrid, type LucideIcon } from 'lucide-react'
import type { MemoryRow } from '@/lib/types'

export type CollectionsProps = {
  memories: MemoryRow[]
  activeFolder: string | null
  onSelectFolder: (tag: string | null) => void
}

type FolderEntry = { tag: string; count: number }

export function Collections({
  memories,
  activeFolder,
  onSelectFolder,
}: CollectionsProps) {
  // Build unique tag folders dynamically with live counts — no hardcoding.
  const folders = useMemo<FolderEntry[]>(() => {
    const counts = new Map<string, number>()
    for (const m of memories) {
      const tags = m.tags ?? []
      for (const t of tags) {
        if (!t) continue
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }, [memories])

  const totalCount = memories.length

  // Hide the panel entirely while loading or when there are zero memories —
  // the empty state already speaks for itself.
  if (totalCount === 0) return null

  return (
    <section className="mx-auto w-full max-w-6xl px-5">
      <div className="mb-5 flex items-center gap-2.5">
        <Folder className="h-[18px] w-[18px] text-zinc-400" />
        <h3 className="text-sm font-medium text-zinc-600">Collections</h3>
        <span className="text-xs text-zinc-400">
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

        {folders.map(({ tag, count }) => (
          <FolderPill
            key={tag}
            icon={activeFolder === tag ? FolderOpen : Folder}
            label={tag}
            count={count}
            active={activeFolder === tag}
            onClick={() => onSelectFolder(activeFolder === tag ? null : tag)}
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
          ? 'border-purple-200 bg-purple-50 text-purple-700 shadow-[0_4px_20px_rgba(139,92,246,0.08)]'
          : 'border-zinc-100 bg-white text-zinc-600 hover:border-zinc-200 hover:bg-zinc-50 hover:-translate-y-0.5'
      }`}
    >
      <Icon
        className={`h-[18px] w-[18px] transition-colors duration-300 ${
          active
            ? 'text-purple-500'
            : 'text-zinc-400 group-hover:text-purple-500'
        }`}
      />
      <span className="capitalize">{label}</span>
      <span
        className={`text-xs font-semibold tabular-nums transition-colors duration-300 ${
          active ? 'text-purple-400' : 'text-zinc-400'
        }`}
      >
        {count}
      </span>
    </button>
  )
}
