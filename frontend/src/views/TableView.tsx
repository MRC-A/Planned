// The main view: one row per task with every field the other views rely
// on (status, priority, dates, duration, dependencies, tags).
// Subtasks are hidden until you expand their parent (click the chevron) —
// see App.tsx/CLAUDE.md for the rule shared with Calendar and Gantt; To-Do
// is the one view where subtasks show up unconditionally.
import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import DeleteConfirmDialog from '@/components/delete-confirm-dialog'
import ShowCompletedToggle from '@/components/show-completed-toggle'
import TaskDetailDialog from '@/components/task-detail-dialog'
import TaskFormDialog from '@/components/task-form-dialog'
import { useShowCompleted } from '@/hooks/use-show-completed'
import {
  PRIORITY_BADGE_VARIANT,
  PRIORITY_LABEL,
  PRIORITY_WEIGHT,
  STATUS_BADGE_VARIANT,
  STATUS_LABEL,
  formatDate,
} from '@/lib/task-display'
import type { Task, TaskDraft, TaskPatch, TaskPriority, TaskStatus } from '@/types/task'

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
}

type SortMode = 'none' | 'priority' | 'startDate' | 'dueDate' | 'status'

const SORT_LABEL: Record<SortMode, string> = {
  none: 'Default',
  priority: 'Priority',
  startDate: 'Start date',
  dueDate: 'Due date',
  status: 'Status',
}

// Ascending in the natural workflow order (todo → in_progress → done),
// rather than PRIORITY_WEIGHT's "most urgent first" convention — status
// isn't a scale of urgency the same way.
const STATUS_WEIGHT: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  done: 2,
}

function compareByOptionalDate(a: string | null, b: string | null): number {
  if (!a && !b) return 0
  if (!a) return 1 // tasks with no date sort last
  if (!b) return -1
  return new Date(a).getTime() - new Date(b).getTime()
}

// Applied to both the top-level list and each parent's children (in
// renderRow and the render below), so an expanded subtask list follows the
// same order rather than staying in raw insertion order.
function sortTasks(list: Task[], mode: SortMode): Task[] {
  if (mode === 'none') return list
  return [...list].sort((a, b) => {
    switch (mode) {
      case 'priority':
        return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
      case 'startDate':
        return compareByOptionalDate(a.startDate, b.startDate)
      case 'dueDate':
        return compareByOptionalDate(a.dueDate, b.dueDate)
      case 'status':
        return STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status]
    }
  })
}

interface TableViewProps {
  tasks: Task[]
  loading: boolean
  error: string | null
  onCreate: (draft: TaskDraft) => Promise<unknown>
  onEdit: (id: number, patch: TaskPatch) => Promise<void>
  onCycleStatus: (task: Task) => void
  onDelete: (id: number) => Promise<void>
}

function taskTitle(tasks: Task[], id: number | null): string | null {
  if (id === null) return null
  return tasks.find((t) => t.id === id)?.title ?? `#${id}`
}

export default function TableView({ tasks, loading, error, onCreate, onEdit, onCycleStatus, onDelete }: TableViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [sortMode, setSortMode] = useState<SortMode>('none')
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskPriority>('all')
  const [tagFilter, setTagFilter] = useState<'all' | string>('all')
  const { showCompleted, toggle: toggleShowCompleted } = useShowCompleted('table')

  const allTags = Array.from(new Set(tasks.flatMap((t) => t.tags))).sort()
  const filtersActive = search.trim() !== '' || statusFilter !== 'all' || priorityFilter !== 'all' || tagFilter !== 'all'

  function clearFilters() {
    setSearch('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setTagFilter('all')
  }

  // Done tasks are hidden by default (see hooks/use-show-completed.ts) —
  // applied at both levels, so a done subtask doesn't linger under an
  // expanded parent either. Explicitly filtering to "Done" bypasses that
  // default rather than silently showing nothing — the filter is a more
  // deliberate signal than the toggle's default.
  const showDone = showCompleted || statusFilter === 'done'
  const visibleTasks = showDone ? tasks : tasks.filter((t) => t.status !== 'done')
  const hiddenCount = tasks.length - visibleTasks.length

  const filteredTasks = visibleTasks.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
    if (tagFilter !== 'all' && !t.tags.includes(tagFilter)) return false
    const q = search.trim().toLowerCase()
    if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false
    return true
  })
  const topLevel = sortTasks(
    filteredTasks.filter((t) => t.parentId === null),
    sortMode,
  )

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  function renderRow(task: Task, isSubtask: boolean) {
    const children = sortTasks(filteredTasks.filter((t) => t.parentId === task.id), sortMode)
    const isExpanded = expanded.has(task.id)
    // Done takes priority over the subtask tint — it's the more useful
    // signal, and only shows up at all once "Show completed" reveals it.
    const rowClassName = [
      task.status === 'done' ? 'bg-done' : isSubtask ? 'bg-muted/30' : '',
      isSubtask ? 'text-xs' : '',
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <TableRow
        key={task.id}
        className={`cursor-pointer ${rowClassName}`.trim() || undefined}
        onClick={() => setDetailTask(task)}
      >
        <TableCell className="font-medium text-foreground">
          <div className="flex items-center gap-1" style={isSubtask ? { paddingLeft: '2rem' } : undefined}>
            {!isSubtask && children.length > 0 ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleExpanded(task.id)
                }}
                className="text-muted-foreground hover:text-foreground"
                title={isExpanded ? 'Collapse subtasks' : 'Show subtasks'}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              !isSubtask && <span className="w-3.5" />
            )}
            {task.title}
          </div>
        </TableCell>
        <TableCell>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onCycleStatus(task)
            }}
            title="Click to advance status"
          >
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
          <div className="flex" onClick={(e) => e.stopPropagation()}>
            <TaskFormDialog
              tasks={tasks}
              task={task}
              onSubmit={(values) => onEdit(task.id, values)}
              trigger={
                <Button variant="ghost" size="icon-sm" title="Edit task">
                  <Pencil className="text-muted-foreground" />
                </Button>
              }
            />
            <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(task)} title="Delete task">
              <Trash2 className="text-muted-foreground" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading
            ? 'Loading…'
            : `${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'}` +
              (!showDone && hiddenCount > 0 ? ` (${hiddenCount} completed hidden)` : '')}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort by</span>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABEL) as SortMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {SORT_LABEL[mode]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ShowCompletedToggle
            showCompleted={showCompleted}
            hiddenCount={hiddenCount}
            onToggle={toggleShowCompleted}
          />
          <TaskFormDialog tasks={tasks} onSubmit={onCreate} trigger={<Button size="sm">New task</Button>} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or description…"
          className="h-8 w-56"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as typeof priorityFilter)}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allTags.length > 0 && (
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tags</SelectItem>
              {allTags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear filters
          </button>
        )}
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
              <TableHead>Depends on</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {topLevel.map((task) => {
              const children = sortTasks(filteredTasks.filter((t) => t.parentId === task.id), sortMode)
              return (
                <Fragment key={task.id}>
                  {renderRow(task, false)}
                  {expanded.has(task.id) && children.map((child) => renderRow(child, true))}
                </Fragment>
              )
            })}
            {!loading && tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  No tasks yet — create one to get started.
                </TableCell>
              </TableRow>
            )}
            {!loading && tasks.length > 0 && topLevel.length === 0 && filtersActive && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  No tasks match your search/filters.{' '}
                  <button onClick={clearFilters} className="text-foreground underline underline-offset-2">
                    Clear them
                  </button>
                  .
                </TableCell>
              </TableRow>
            )}
            {!loading && tasks.length > 0 && topLevel.length === 0 && !filtersActive && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  Every task is completed — "Show completed" above will bring them back.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <TaskDetailDialog
        task={detailTask}
        tasks={tasks}
        open={detailTask !== null}
        onOpenChange={(o) => !o && setDetailTask(null)}
      />

      <DeleteConfirmDialog
        task={deleteTarget}
        childCount={deleteTarget ? tasks.filter((t) => t.parentId === deleteTarget.id).length : 0}
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
    </div>
  )
}

export { NEXT_STATUS }
