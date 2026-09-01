// Thin fetch wrapper around the backend task API — converts between the
// backend's snake_case/comma-separated shape and the frontend Task type.
import type { Task, TaskDraft, TaskPatch, TaskPriority, TaskStatus } from '@/types/task'

const API_BASE = '/api/tasks'

interface ApiTask {
  id: number
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  start_date: string | null
  due_date: string | null
  duration_hours: number | null
  progress: number
  depends_on: number | null
  tags: string | null
  created_at: string
  updated_at: string
}

function fromApi(raw: ApiTask): Task {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    priority: raw.priority,
    startDate: raw.start_date,
    dueDate: raw.due_date,
    durationHours: raw.duration_hours,
    progress: raw.progress,
    dependsOn: raw.depends_on,
    tags: raw.tags
      ? raw.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function toApiPayload(draft: TaskPatch): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (draft.title !== undefined) payload.title = draft.title
  if (draft.description !== undefined) payload.description = draft.description
  if (draft.status !== undefined) payload.status = draft.status
  if (draft.priority !== undefined) payload.priority = draft.priority
  if (draft.startDate !== undefined) payload.start_date = draft.startDate
  if (draft.dueDate !== undefined) payload.due_date = draft.dueDate
  if (draft.durationHours !== undefined) payload.duration_hours = draft.durationHours
  if (draft.progress !== undefined) payload.progress = draft.progress
  if (draft.dependsOn !== undefined) payload.depends_on = draft.dependsOn
  if (draft.tags !== undefined) payload.tags = draft.tags.join(', ')
  return payload
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

export async function listTasks(): Promise<Task[]> {
  const raw = await request<ApiTask[]>('/')
  return raw.map(fromApi)
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  const raw = await request<ApiTask>('/', {
    method: 'POST',
    body: JSON.stringify(toApiPayload(draft)),
  })
  return fromApi(raw)
}

export async function updateTask(id: number, patch: TaskPatch): Promise<Task> {
  const raw = await request<ApiTask>(`/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(toApiPayload(patch)),
  })
  return fromApi(raw)
}

export async function deleteTask(id: number): Promise<void> {
  await request<void>(`/${id}`, { method: 'DELETE' })
}

// Not under API_BASE (/api/tasks) — this is the launcher's "quit" action,
// see backend/src/planned/api/system.py. The backend kills itself shortly
// after responding, so a network error here (connection dropped mid-flight)
// is the expected outcome, not a bug — swallow it.
export async function shutdownApp(): Promise<void> {
  try {
    await fetch('/api/system/shutdown', { method: 'POST' })
  } catch {
    // expected once the backend exits
  }
}
