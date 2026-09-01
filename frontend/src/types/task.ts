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
