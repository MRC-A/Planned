// Loads tasks from the backend and exposes CRUD actions that refetch on
// success. Deliberately simple (refetch over optimistic updates) since the
// task list is small and local.
import { useCallback, useEffect, useState } from 'react'
import { createTask, deleteTask, listTasks, updateTask } from '@/lib/api'
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

  const remove = useCallback(
    async (id: number) => {
      await deleteTask(id)
      await refresh()
    },
    [refresh],
  )

  return { tasks, loading, error, refresh, add, edit, remove }
}
