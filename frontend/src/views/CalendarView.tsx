// Month calendar: each top-level task appears on its start–due range (or a
// single day if it only has one of the two dates). Subtasks never appear
// here (only in Table, when expanded, and in To-Do) — see CLAUDE.md.
// Tasks with neither date can't be placed and are simply not shown.
import { useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventClickArg, EventContentArg, EventDropArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import ShowCompletedToggle from '@/components/show-completed-toggle'
import TaskDetailDialog from '@/components/task-detail-dialog'
import { useShowCompleted } from '@/hooks/use-show-completed'
import { addDays, daysBetween, formatISODate, shiftISODate } from '@/lib/task-dates'
import { DONE_BG_COLOR, DONE_TEXT_COLOR, PRIORITY_BG_COLOR, PRIORITY_TEXT_COLOR } from '@/lib/task-display'
import '@/styles/calendar.css'
import type { Task, TaskPatch } from '@/types/task'

interface CalendarViewProps {
  tasks: Task[]
  onEdit: (id: number, patch: TaskPatch) => Promise<void>
}

// Exported for tests: this is where C4 lived (see lib/task-dates.ts).
export function toEvents(tasks: Task[]) {
  return tasks
    .filter((t) => t.startDate || t.dueDate)
    .map((t) => {
      // Bare YYYY-MM-DD, not the full datetime string — feeding FullCalendar
      // an unambiguous all-day date rather than letting it parse a
      // time-bearing string itself (its own source of the same class of
      // timezone bug this fix is for).
      const start = (t.startDate ?? t.dueDate!).slice(0, 10)
      // FullCalendar's all-day `end` is exclusive, so a due date needs +1 day
      // to actually cover that day on the grid.
      const end = t.dueDate ? shiftISODate(t.dueDate, 1) : shiftISODate(start, 1)
      // Done overrides the priority color — only reachable once "Show
      // completed" reveals the event at all (see task-display.ts).
      const bg = t.status === 'done' ? DONE_BG_COLOR : PRIORITY_BG_COLOR[t.priority]
      const text = t.status === 'done' ? DONE_TEXT_COLOR : PRIORITY_TEXT_COLOR[t.priority]
      return {
        id: String(t.id),
        title: t.title,
        start,
        end,
        allDay: true,
        backgroundColor: bg,
        borderColor: bg,
        textColor: text,
      }
    })
}

function renderEventContent(arg: EventContentArg) {
  return <span className="truncate px-1 text-xs">{arg.event.title}</span>
}

// F7 — a plain move preserves the task's span and which dates it actually
// has: a task with only a due date stays that way rather than gaining a
// start date it never had. Mirrors GanttView's own drag-to-move, which
// shifts whichever of startDate/dueDate is set by the same delta rather
// than re-deriving both ends from FullCalendar's redrawn event box.
// Exported for tests, same pattern as toEvents above.
export function dropPatch(task: Task, deltaDays: number): TaskPatch {
  const patch: TaskPatch = {}
  if (task.startDate) patch.startDate = shiftISODate(task.startDate, deltaDays)
  if (task.dueDate) patch.dueDate = shiftISODate(task.dueDate, deltaDays)
  return patch
}

// A resize inherently defines a new range, so — unlike a move — both ends
// become explicit real dates rather than preserving whichever the task had
// before. `end` is FullCalendar's exclusive all-day end (see toEvents).
export function resizePatch(start: Date, end: Date | null): TaskPatch {
  const startISO = formatISODate(start)
  const dueISO = end ? formatISODate(addDays(end, -1)) : startISO
  return { startDate: startISO, dueDate: dueISO }
}

export default function CalendarView({ tasks, onEdit }: CalendarViewProps) {
  const { showCompleted, toggle: toggleShowCompleted } = useShowCompleted('calendar')
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const topLevel = tasks.filter((t) => t.parentId === null)
  // Done tasks are hidden by default (see hooks/use-show-completed.ts) —
  // otherwise a finished task stays on the calendar forever, still colored
  // as if it were still active.
  const visible = showCompleted ? topLevel : topLevel.filter((t) => t.status !== 'done')
  const hiddenCount = topLevel.length - visible.length
  const events = toEvents(visible)
  const unscheduled = visible.length - events.length

  function handleEventClick(info: EventClickArg) {
    const clicked = visible.find((t) => String(t.id) === info.event.id)
    if (clicked) setDetailTask(clicked)
  }

  // Drag to move (F7). The day delta is read from the two Date objects
  // FullCalendar hands back rather than its own Duration decomposition
  // (years/months/days) — daysBetween is the one place this app does that
  // arithmetic, so it stays correct even for a drag that crosses a DST
  // transition, which a naive Duration read would not guarantee.
  async function handleEventDrop(info: EventDropArg) {
    const id = Number(info.event.id)
    const task = tasks.find((t) => t.id === id)
    const oldStart = info.oldEvent.start
    const newStart = info.event.start
    if (!task || !oldStart || !newStart) {
      info.revert()
      return
    }
    const deltaDays = daysBetween(oldStart, newStart)
    if (deltaDays === 0) return
    setActionError(null)
    try {
      await onEdit(id, dropPatch(task, deltaDays))
    } catch (err) {
      info.revert()
      setActionError(err instanceof Error ? err.message : 'Could not reschedule that task.')
    }
  }

  // Drag an edge to resize (F7). Only the right edge is draggable by
  // default (eventResizableFromStart is off) — dragging the due-date end is
  // the common case, and FullCalendar's own default keeps this from also
  // catching accidental drags on the left edge of a short event.
  async function handleEventResize(info: EventResizeDoneArg) {
    const id = Number(info.event.id)
    if (!info.event.start) {
      info.revert()
      return
    }
    setActionError(null)
    try {
      await onEdit(id, resizePatch(info.event.start, info.event.end))
    } catch (err) {
      info.revert()
      setActionError(err instanceof Error ? err.message : 'Could not reschedule that task.')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <ShowCompletedToggle
          showCompleted={showCompleted}
          hiddenCount={hiddenCount}
          onToggle={toggleShowCompleted}
        />
      </div>
      {actionError && <p className="text-xs text-destructive">{actionError}</p>}

      <div className="rounded-lg border border-border bg-card p-3">
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          height="auto"
          events={events}
          eventContent={renderEventContent}
          eventClick={handleEventClick}
          editable
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
        />
      </div>
      {unscheduled > 0 && (
        <p className="text-xs text-muted-foreground">
          {unscheduled} task{unscheduled === 1 ? '' : 's'} without a date not shown.
        </p>
      )}

      <TaskDetailDialog
        task={detailTask}
        tasks={tasks}
        open={detailTask !== null}
        onOpenChange={(o) => !o && setDetailTask(null)}
      />
    </div>
  )
}
