// Read-only "what is this task?" summary, opened by clicking a task in any
// view (Table row, To-Do item, Calendar event, Gantt bar). Deliberately not
// the same component as TaskFormDialog's edit form — this is a quick look,
// not every field, with the description (usually cut off or absent
// elsewhere) front and center. Controlled rather than trigger-wrapped like
// TaskFormDialog, since the "trigger" here is a different kind of element
// per view (a table row, a calendar event pill, a Gantt bar) rather than one
// button each view can wrap.
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  PRIORITY_BADGE_VARIANT,
  PRIORITY_LABEL,
  RECURRENCE_LABEL,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
  formatDate,
} from '@/lib/task-display'
import type { Task } from '@/types/task'

interface TaskDetailDialogProps {
  task: Task | null
  tasks: Task[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

function relatedTaskTitle(tasks: Task[], id: number | null): string | null {
  if (id === null) return null
  return tasks.find((t) => t.id === id)?.title ?? `#${id}`
}

export default function TaskDetailDialog({ task, tasks, open, onOpenChange }: TaskDetailDialogProps) {
  // The caller nulls `task` out the moment the dialog starts closing (so it
  // can reset its own selection state) — keep showing the last non-null
  // task instead of blanking the content mid closing-animation.
  const [shown, setShown] = useState<Task | null>(task)
  useEffect(() => {
    if (task) setShown(task)
  }, [task])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {shown && <TaskSummary task={shown} tasks={tasks} />}
      </DialogContent>
    </Dialog>
  )
}

function TaskSummary({ task, tasks }: { task: Task; tasks: Task[] }) {
  const dependsOnTitle = relatedTaskTitle(tasks, task.dependsOn)
  const parentTitle = relatedTaskTitle(tasks, task.parentId)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{task.title}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[task.status]}>{STATUS_LABEL[task.status]}</Badge>
          <Badge variant={PRIORITY_BADGE_VARIANT[task.priority]}>{PRIORITY_LABEL[task.priority]}</Badge>
          {task.recurrence && (
            <Badge variant="outline">Repeats {RECURRENCE_LABEL[task.recurrence].toLowerCase()}</Badge>
          )}
          {parentTitle && <span className="text-xs text-muted-foreground">Subtask of "{parentTitle}"</span>}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Description</span>
          {task.description ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">{task.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No description provided.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">Start date</span>
            <p>{formatDate(task.startDate)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Due date</span>
            <p>{formatDate(task.dueDate)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Duration</span>
            <p>{task.durationHours !== null ? `${task.durationHours}h` : '—'}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Depends on</span>
            <p>{dependsOnTitle ?? '—'}</p>
          </div>
        </div>

        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
