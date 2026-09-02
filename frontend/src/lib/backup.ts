// Export the current task list as a downloadable JSON file, and parse one
// back in for import — the only way to get data out of (or into) the
// single local SQLite file, flagged as the #1 risk for a personal planner
// in the 2026-09-01 review (F2). Round-trips through the same shape
// listTasks() already returns (camelCase Task[]), not the backend's raw
// snake_case — this is a backup of what the app shows you, not a DB dump.
import type { Task, TaskDraft } from '@/types/task'

export function downloadTasksBackup(tasks: Task[]): void {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `planned-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// A loosely-typed imported row — only `title` is required, everything else
// optional, so a file from an older/newer version of the app (or a
// hand-edited one) still imports what it can rather than failing outright.
export interface ImportedTaskRow {
  id?: number
  title: string
  description?: string
  status?: Task['status']
  priority?: Task['priority']
  startDate?: string | null
  dueDate?: string | null
  durationHours?: number | null
  dependsOn?: number | null
  parentId?: number | null
  tags?: string[]
}

export function parseTasksBackup(raw: string): ImportedTaskRow[] {
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) throw new Error('Expected a JSON array of tasks.')
  return data.filter((row): row is ImportedTaskRow => typeof row?.title === 'string')
}

// The imported ids are stale (from whatever database exported the file) —
// parentId/dependsOn get dropped here and relinked in a second pass once
// every row has a real new id (see BackupControls.handleImportFile).
export function toImportDraft(row: ImportedTaskRow): TaskDraft {
  return {
    title: row.title,
    description: row.description ?? '',
    status: row.status ?? 'todo',
    priority: row.priority ?? 'medium',
    startDate: row.startDate ?? null,
    dueDate: row.dueDate ?? null,
    durationHours: row.durationHours ?? null,
    dependsOn: null,
    parentId: null,
    tags: row.tags ?? [],
  }
}
