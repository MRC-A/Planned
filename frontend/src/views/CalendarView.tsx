// Month calendar: each task appears on its start–due range (or a single
// day if it only has one of the two dates). Tasks with neither date can't
// be placed and are simply not shown.
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import type { EventContentArg } from '@fullcalendar/core'
import { Badge } from '@/components/ui/badge'
import { PRIORITY_BADGE_VARIANT } from '@/lib/task-display'
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
      return {
        id: String(t.id),
        title: t.title,
        start,
        end,
        allDay: true,
        extendedProps: { task: t },
      }
    })
}

function renderEventContent(arg: EventContentArg) {
  const task = arg.event.extendedProps.task as Task
  return (
    <div className="flex items-center gap-1 overflow-hidden px-0.5 py-px">
      <Badge variant={PRIORITY_BADGE_VARIANT[task.priority]} className="h-1.5 w-1.5 shrink-0 rounded-full p-0" />
      <span className="truncate text-xs text-foreground">{arg.event.title}</span>
    </div>
  )
}

export default function CalendarView({ tasks }: CalendarViewProps) {
  const events = toEvents(tasks)
  const unscheduled = tasks.length - events.length

  return (
    <div className="flex flex-col gap-2">
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
