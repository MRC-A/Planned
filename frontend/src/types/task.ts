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
  dependsOn: number | null
  parentId: number | null
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
// the fields the assistant doesn't set (status, dependsOn).
export interface ProposedTask {
  title: string
  description: string
  priority: TaskPriority
  startDate: string | null
  dueDate: string | null
  durationHours: number | null
  tags: string[]
  // 0-based index into the same proposal batch this task belongs to — set
  // when the assistant proposes this as a subtask of another task in the
  // same reply. Null for a standalone/top-level proposal.
  parentRef: number | null
}

// A change the chat assistant suggests to an EXISTING task (F5) —
// rescheduling, a status/priority change, or any other field edit. Every
// field but `taskId` is optional and, deliberately, `TaskPatch`-shaped
// rather than always present: the backend (api/chat.py::_build_proposed_updates)
// only includes the keys the model actually changed, so an omitted field
// here means "leave it alone" — an explicit `null` (e.g. `dueDate: null`)
// is a real, intentional clear, not the same as absent.
export interface ProposedTaskUpdate {
  taskId: number
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  startDate?: string | null
  dueDate?: string | null
  durationHours?: number | null
  tags?: string[]
}
