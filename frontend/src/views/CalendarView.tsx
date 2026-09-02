// Month calendar: each top-level task appears on its start–due range (or a
// single day if it only has one of the two dates). Subtasks never appear
// here (only in Table, when expanded, and in To-Do) — see CLAUDE.md.
// Tasks with neither date can't be placed and are simply not shown.
import { useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import type { EventClickArg, EventContentArg } from '@fullcalendar/core'
import ShowCompletedToggle from '@/components/show-completed-toggle'
import TaskDetailDialog from '@/components/task-detail-dialog'
import { useShowCompleted } from '@/hooks/use-show-completed'
import { DONE_BG_COLOR, DONE_TEXT_COLOR, PRIORITY_BG_COLOR, PRIORITY_TEXT_COLOR } from '@/lib/task-display'
import '@/styles/calendar.css'
import type { Task } from '@/types/task'

interface CalendarViewProps {
  tasks: Task[]
}

function addDays(iso: string, days: number): string {
  // Parse as local midnight (a bare "T00:00:00" with no timezone marker is
  // what makes JS parse it as local time instead of UTC — same trick as
  // GanttView's parseDate) and format back with local getters, never
  // toISOString(). toISOString() always converts to UTC, which is exactly
  // what caused C4: for a UTC+2 user, local midnight Oct 1 became 22:00 UTC
  // on Sep 30, so a due date's "+1 day, exclusive end" adjustment silently
  // lost a day and that day never rendered on the calendar.
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  d.setDate(d.getDate() + days)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toEvents(tasks: Task[]) {
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
      const end = t.dueDate ? addDays(t.dueDate, 1) : addDays(start, 1)
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

export default function CalendarView({ tasks }: CalendarViewProps) {
  const { showCompleted, toggle: toggleShowCompleted } = useShowCompleted('calendar')
  const [detailTask, setDetailTask] = useState<Task | null>(null)

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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <ShowCompletedToggle
          showCompleted={showCompleted}
          hiddenCount={hiddenCount}
          onToggle={toggleShowCompleted}
        />
      </div>
      <div className="rounded-lg border border-border bg-card p-3">
        <FullCalendar
          plugins={[dayGridPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          height="auto"
          events={events}
          eventContent={renderEventContent}
          eventClick={handleEventClick}
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
