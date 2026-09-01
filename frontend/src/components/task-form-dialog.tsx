// Full task form — every field on the shared Task model. Used both for
// creating a new task (no `task` prop) and editing an existing one
// (`task` prop provided, form pre-filled from it).
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PRIORITY_LABEL, STATUS_LABEL } from '@/lib/task-display'
import type { Task, TaskDraft, TaskPriority, TaskStatus } from '@/types/task'

interface TaskFormDialogProps {
  tasks: Task[]
  task?: Task
  trigger: React.ReactNode
  onSubmit: (values: TaskDraft) => Promise<void>
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done']
const NO_DEPENDENCY = 'none'
const NO_PARENT = 'none'

interface FormState {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  startDate: string
  dueDate: string
  durationHours: string
  progress: string
  dependsOn: string
  parentId: string
  tags: string
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'medium',
  startDate: '',
  dueDate: '',
  durationHours: '',
  progress: '0',
  dependsOn: NO_DEPENDENCY,
  parentId: NO_PARENT,
  tags: '',
}

function toFormState(task: Task | undefined): FormState {
  if (!task) return EMPTY_FORM
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    // Dates from the API are full datetimes ("2026-09-30T00:00:00"); a
    // date input needs just the YYYY-MM-DD part.
    startDate: task.startDate ? task.startDate.slice(0, 10) : '',
    dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
    durationHours: task.durationHours !== null ? String(task.durationHours) : '',
    progress: String(task.progress),
    dependsOn: task.dependsOn !== null ? String(task.dependsOn) : NO_DEPENDENCY,
    parentId: task.parentId !== null ? String(task.parentId) : NO_PARENT,
    tags: task.tags.join(', '),
  }
}

export default function TaskFormDialog({ tasks, task, trigger, onSubmit }: TaskFormDialogProps) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(() => toFormState(task))
  const [submitting, setSubmitting] = useState(false)

  const isEditing = task !== undefined

  // Re-sync the form with the task's current values each time the dialog
  // opens, rather than once on mount — the task may have changed since.
  useEffect(() => {
    if (open) setForm(toFormState(task))
  }, [open, task])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({
        title: form.title.trim(),
        description: form.description.trim(),
        status: form.status,
        priority: form.priority,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        durationHours: form.durationHours ? Number(form.durationHours) : null,
        progress: form.progress ? Number(form.progress) : 0,
        dependsOn: form.dependsOn === NO_DEPENDENCY ? null : Number(form.dependsOn),
        parentId: form.parentId === NO_PARENT ? null : Number(form.parentId),
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      })
      setOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit task' : 'New task'}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Task title"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional details"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-status">Status</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v as TaskStatus)}>
                <SelectTrigger id="task-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set('priority', v as TaskPriority)}>
                <SelectTrigger id="task-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-start-date">Start date</Label>
              <Input
                id="task-start-date"
                type="date"
                value={form.startDate}
                onChange={(e) => set('startDate', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-due-date">Due date</Label>
              <Input
                id="task-due-date"
                type="date"
                value={form.dueDate}
                onChange={(e) => set('dueDate', e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-duration">Duration (hours)</Label>
              <Input
                id="task-duration"
                type="number"
                min="0"
                step="0.5"
                value={form.durationHours}
                onChange={(e) => set('durationHours', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-progress">Progress (%)</Label>
              <Input
                id="task-progress"
                type="number"
                min="0"
                max="100"
                value={form.progress}
                onChange={(e) => set('progress', e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-depends-on">Depends on</Label>
            <Select value={form.dependsOn} onValueChange={(v) => set('dependsOn', v)}>
              <SelectTrigger id="task-depends-on" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEPENDENCY}>None</SelectItem>
                {tasks
                  .filter((t) => t.id !== task?.id)
                  .map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-parent">Parent task</Label>
            <Select value={form.parentId} onValueChange={(v) => set('parentId', v)}>
              <SelectTrigger id="task-parent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>None — top-level task</SelectItem>
                {tasks
                  // Subtasks are one level deep: only a top-level task
                  // (parentId === null) can be picked as a parent — this
                  // also rules out the task itself, since a task with
                  // children of its own is (trivially) top-level already,
                  // but never one of its own children either way.
                  .filter((t) => t.id !== task?.id && t.parentId === null)
                  .map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.title}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-tags">Tags</Label>
            <Input
              id="task-tags"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="Comma-separated, e.g. backend, urgent"
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting || !form.title.trim()}>
              {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
