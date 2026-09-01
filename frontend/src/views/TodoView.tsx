// Simplified, priority-first view of the same shared tasks: what should I
// work on next? Completed tasks are pushed to the bottom either way.
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PRIORITY_BADGE_VARIANT, PRIORITY_LABEL, PRIORITY_WEIGHT, formatDate } from '@/lib/task-display'
import type { Task } from '@/types/task'

interface TodoViewProps {
  tasks: Task[]
  loading: boolean
  onToggleDone: (task: Task) => void
}

type SortMode = 'priority' | 'dueDate'

function compareByDueDate(a: Task, b: Task): number {
  if (!a.dueDate && !b.dueDate) return 0
  if (!a.dueDate) return 1 // tasks with no due date sort last
  if (!b.dueDate) return -1
  return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
}

export default function TodoView({ tasks, loading, onToggleDone }: TodoViewProps) {
  const [sortMode, setSortMode] = useState<SortMode>('priority')

  const sorted = [...tasks].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1
    if (a.status !== 'done' && b.status === 'done') return -1
    return sortMode === 'priority'
      ? PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
      : compareByDueDate(a, b)
  })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <div className="flex items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">Sort by</span>
        <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="dueDate">Due date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && sorted.length === 0 && <p className="text-sm text-muted-foreground">No tasks yet.</p>}

      {!loading && sorted.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sorted.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <Checkbox checked={task.status === 'done'} onCheckedChange={() => onToggleDone(task)} />
              <span
                className={`flex-1 text-sm font-medium ${
                  task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'
                }`}
              >
                {task.title}
              </span>
              <span className="text-xs text-muted-foreground">{formatDate(task.dueDate)}</span>
              <Badge variant={PRIORITY_BADGE_VARIANT[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
