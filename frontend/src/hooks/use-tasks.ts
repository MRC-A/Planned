// Loads tasks from the backend and exposes CRUD actions that refetch on
// success. Deliberately simple (refetch over optimistic updates) since the
// task list is small and local.
import { useCallback, useEffect, useState } from 'react'
import { bulkDeleteTasks, createTask, listTasks, updateTask } from '@/lib/api'
import type { Task, TaskDraft } from '@/types/task'

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setTasks(await listTasks())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const add = useCallback(
    async (draft: TaskDraft) => {
      const task = await createTask(draft)
      await refresh()
      return task
    },
    [refresh],
  )

  const edit = useCallback(
    async (id: number, patch: Parameters<typeof updateTask>[1]) => {
      await updateTask(id, patch)
      await refresh()
    },
    [refresh],
  )

  // Deleting one task and deleting many go through the same bulk endpoint —
  // the Table's per-row trash icon just passes a one-element array (see
  // CLAUDE.md). `DELETE /api/tasks/{id}` still exists server-side for direct
  // API use, it simply has no frontend caller.
  const bulkRemove = useCallback(
    async (ids: number[]) => {
      await bulkDeleteTasks(ids)
      await refresh()
    },
    [refresh],
  )

  return { tasks, loading, error, refresh, add, edit, bulkRemove }
}
