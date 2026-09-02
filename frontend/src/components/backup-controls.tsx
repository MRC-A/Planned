// Export/Import buttons, global (not per-view) — see lib/backup.ts. Import
// runs in two passes, same shape as ChatPanel's parentRef handling: create
// every task flat first so stale ids from the file map to real new ones,
// then relink parentId/dependsOn now that every target actually exists.
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { createTask, updateTask } from '@/lib/api'
import { downloadTasksBackup, parseTasksBackup, toImportDraft } from '@/lib/backup'
import type { Task, TaskPatch } from '@/types/task'

interface BackupControlsProps {
  tasks: Task[]
  onImported: () => Promise<void>
}

export default function BackupControls({ tasks, onImported }: BackupControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  function handleExport() {
    downloadTasksBackup(tasks)
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file next time
    if (!file) return

    let rows
    try {
      rows = parseTasksBackup(await file.text())
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'That file is not valid JSON.' })
      return
    }
    if (rows.length === 0) {
      setStatus({ type: 'error', message: 'No valid tasks found in that file.' })
      return
    }
    const confirmed = window.confirm(
      `Import ${rows.length} task${rows.length === 1 ? '' : 's'}? This adds them alongside your existing tasks — it doesn't replace anything.`,
    )
    if (!confirmed) return

    setImporting(true)
    setStatus(null)
    try {
      // Pass 1: create every task flat, collecting old id (from the file)
      // -> new id (from the database). A single row's failure (a backend
      // hiccup, a bad value) is recorded and skipped rather than aborting
      // the whole import — an earlier version threw on the first error and
      // left everything created up to that point as permanent, unlinked
      // flat duplicates with no indication anything had gone wrong (a real
      // incident: an import racing a backend restart silently left ~35
      // half-imported rows behind).
      const idMap = new Map<number, number>()
      const failedCreates: string[] = []
      for (const row of rows) {
        try {
          const created = await createTask(toImportDraft(row))
          if (row.id !== undefined) idMap.set(row.id, created.id)
        } catch {
          failedCreates.push(row.title)
        }
      }

      // Pass 2: relink parentId/dependsOn for whatever pass 1 actually
      // created. A reference to an id that wasn't in this file (or that
      // failed to create) is dropped rather than failing the import —
      // same "degrade, don't reject the batch" philosophy as the chat
      // assistant's own subtask handling (_sanitize_parent_refs). A
      // relink call itself failing is recorded the same way as a create
      // failure, not fatal to the rest of the batch.
      const failedRelinks: string[] = []
      for (const row of rows) {
        const newId = row.id !== undefined ? idMap.get(row.id) : undefined
        if (newId === undefined) continue
        const patch: TaskPatch = {}
        if (row.parentId !== null && row.parentId !== undefined) {
          const newParentId = idMap.get(row.parentId)
          if (newParentId !== undefined) patch.parentId = newParentId
        }
        if (row.dependsOn !== null && row.dependsOn !== undefined) {
          const newDependsOn = idMap.get(row.dependsOn)
          if (newDependsOn !== undefined) patch.dependsOn = newDependsOn
        }
        if (Object.keys(patch).length === 0) continue
        try {
          await updateTask(newId, patch)
        } catch {
          failedRelinks.push(row.title)
        }
      }

      await onImported()

      const createdCount = idMap.size
      if (failedCreates.length === 0 && failedRelinks.length === 0) {
        setStatus({ type: 'success', message: `Imported ${createdCount} task${createdCount === 1 ? '' : 's'}.` })
      } else {
        const parts = [`Imported ${createdCount}/${rows.length} task${rows.length === 1 ? '' : 's'}.`]
        if (failedCreates.length > 0) {
          parts.push(`Couldn't create: ${failedCreates.join(', ')}.`)
        }
        if (failedRelinks.length > 0) {
          parts.push(`Created but couldn't link to their parent/dependency: ${failedRelinks.join(', ')}.`)
        }
        setStatus({ type: 'error', message: parts.join(' ') })
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status && (
        <span className={`text-xs ${status.type === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {status.message}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={handleExport} disabled={tasks.length === 0}>
        Export
      </Button>
      <Button variant="outline" size="sm" onClick={handleImportClick} disabled={importing}>
        {importing ? 'Importing…' : 'Import'}
      </Button>
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileSelected} className="hidden" />
    </div>
  )
}
