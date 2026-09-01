// Month calendar: each top-level task appears on its start–due range (or a
// single day if it only has one of the two dates). Subtasks never appear
// here (only in Table, when expanded, and in To-Do) — see CLAUDE.md.
// Tasks with neither date can't be placed and are simply not shown.
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import type { EventContentArg } from '@fullcalendar/core'
import ShowCompletedToggle from '@/components/show-completed-toggle'
import { useShowCompleted } from '@/hooks/use-show-completed'
import { DONE_BG_COLOR, DONE_TEXT_COLOR, PRIORITY_BG_COLOR, PRIORITY_TEXT_COLOR } from '@/lib/task-display'
import '@/styles/calendar.css'
import type { Task } from '@/types/task'

interface CalendarViewProps {
  tasks: Task[]
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function toEvents(tasks: Task[]) {
  return tasks
    .filter((t) => t.startDate || t.dueDate)
    .map((t) => {
      const start = t.startDate ?? t.dueDate!
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

  const topLevel = tasks.filter((t) => t.parentId === null)
  // Done tasks are hidden by default (see hooks/use-show-completed.ts) —
  // otherwise a finished task stays on the calendar forever, still colored
  // as if it were still active.
  const visible = showCompleted ? topLevel : topLevel.filter((t) => t.status !== 'done')
  const hiddenCount = topLevel.length - visible.length
  const events = toEvents(visible)
  const unscheduled = visible.length - events.length

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
        />
      </div>
      {unscheduled > 0 && (
        <p className="text-xs text-muted-foreground">
          {unscheduled} task{unscheduled === 1 ? '' : 's'} without a date not shown.
        </p>
      )}
    </div>
  )
}
