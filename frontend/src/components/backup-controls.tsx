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
      // -> new id (from the database) so pass 2 has something to relink.
      const idMap = new Map<number, number>()
      for (const row of rows) {
        const created = await createTask(toImportDraft(row))
        if (row.id !== undefined) idMap.set(row.id, created.id)
      }
      // Pass 2: relink parentId/dependsOn. A reference to an id that
      // wasn't in this file is dropped rather than failing the whole
      // import — same "degrade, don't reject the batch" philosophy as
      // the chat assistant's own subtask handling (_sanitize_parent_refs).
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
        if (Object.keys(patch).length > 0) await updateTask(newId, patch)
      }
      await onImported()
      setStatus({ type: 'success', message: `Imported ${rows.length} task${rows.length === 1 ? '' : 's'}.` })
    } catch (err) {
      // Some tasks may already have been created before the failure —
      // refresh so the list reflects reality rather than looking stale.
      await onImported()
      setStatus({
        type: 'error',
        message: err instanceof Error ? `Import failed partway through: ${err.message}` : 'Import failed partway through.',
      })
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
