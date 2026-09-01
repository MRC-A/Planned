// Mirrors backend/src/planned/models.py::Task — the shared record every
// view (Table, To-Do, Calendar, Gantt) reads from.

export type TaskStatus = 'todo' | 'in_progress' | 'done'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Task {
  id: number
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  startDate: string | null
  dueDate: string | null
  durationHours: number | null
  progress: number
  dependsOn: number | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

// Payload for creating a task: every field but the server-owned ones,
// title required, everything else optional.
export type TaskDraft = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> & {
  title: string
}

// Payload for a partial update — every field optional.
export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>

// A task the chat assistant suggests creating — not yet in the database.
// Same shape as TaskDraft's core fields (assignable to it directly), minus
// the fields the assistant doesn't set (status, progress, dependsOn).
export interface ProposedTask {
  title: string
  description: string
  priority: TaskPriority
  startDate: string | null
  dueDate: string | null
  durationHours: number | null
  tags: string[]
}
