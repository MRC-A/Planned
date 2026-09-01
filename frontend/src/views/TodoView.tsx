// Simplified, priority-first view of the same shared tasks: what should I
// work on next? Completed tasks are pushed to the bottom.
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { mockTasks } from '@/data/mock-tasks'
import { PRIORITY_BADGE_VARIANT, PRIORITY_LABEL, PRIORITY_WEIGHT, formatDate } from '@/lib/task-display'

export default function TodoView() {
  const tasks = [...mockTasks].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1
    if (a.status !== 'done' && b.status === 'done') return -1
    return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
  })

  return (
    <ul className="mx-auto flex max-w-2xl flex-col gap-2">
      {tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
        >
          <Checkbox checked={task.status === 'done'} />
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
  )
}
