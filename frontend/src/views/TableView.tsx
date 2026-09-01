// The main view: one row per task with every field the other views rely
// on (status, priority, dates, duration, progress, dependencies, tags).
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { mockTasks } from '@/data/mock-tasks'
import {
  PRIORITY_BADGE_VARIANT,
  PRIORITY_LABEL,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
  formatDate,
} from '@/lib/task-display'
import type { Task } from '@/types/task'

function taskTitle(tasks: Task[], id: number | null): string | null {
  if (id === null) return null
  return tasks.find((t) => t.id === id)?.title ?? `#${id}`
}

export default function TableView() {
  const tasks = mockTasks

  return (
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="font-medium text-foreground">{task.title}</TableCell>
              <TableCell>
                <Badge variant={STATUS_BADGE_VARIANT[task.status]}>{STATUS_LABEL[task.status]}</Badge>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
