// The main view: one row per task with every field the other views rely
// on (status, priority, dates, duration, progress, dependencies, tags).
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import NewTaskDialog from '@/components/new-task-dialog'
import {
  PRIORITY_BADGE_VARIANT,
  PRIORITY_LABEL,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
  formatDate,
} from '@/lib/task-display'
import type { Task, TaskDraft, TaskStatus } from '@/types/task'

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
}

interface TableViewProps {
  tasks: Task[]
  loading: boolean
  error: string | null
  onCreate: (draft: TaskDraft) => Promise<void>
  onCycleStatus: (task: Task) => void
  onDelete: (id: number) => void
}

function taskTitle(tasks: Task[], id: number | null): string | null {
  if (id === null) return null
  return tasks.find((t) => t.id === id)?.title ?? `#${id}`
}

export default function TableView({ tasks, loading, error, onCreate, onCycleStatus, onDelete }: TableViewProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading…' : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
        </p>
        <NewTaskDialog tasks={tasks} onCreate={onCreate} />
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Start date</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Depends on</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-medium text-foreground">{task.title}</TableCell>
                <TableCell>
                  <button onClick={() => onCycleStatus(task)} title="Click to advance status">
                    <Badge variant={STATUS_BADGE_VARIANT[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                  </button>
                </TableCell>
                <TableCell>
                  <Badge variant={PRIORITY_BADGE_VARIANT[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(task.startDate)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(task.dueDate)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {task.durationHours !== null ? `${task.durationHours}h` : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">{task.progress}%</TableCell>
                <TableCell className="text-muted-foreground">{taskTitle(tasks, task.dependsOn) ?? '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {task.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(task.updatedAt)}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon-sm" onClick={() => onDelete(task.id)} title="Delete task">
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!loading && tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground">
                  No tasks yet — create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export { NEXT_STATUS }
