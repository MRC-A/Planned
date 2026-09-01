// Gantt chart, hand-rolled with CSS Grid — no external Gantt library.
// (An earlier attempt used frappe-gantt; its internal SVG-sizing logic
// never produced a working horizontal scrollbar in this app's layout, and
// debugging it blind, without browser access, wasn't worth the time. This
// version has full control over layout and the sticky task-name column,
// which is exactly what tripped up that integration.)
//
// Tasks with neither a start nor a due date can't be placed on a timeline
// and are simply not shown (count surfaced below the chart).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task, TaskPriority } from '@/types/task'

interface GanttViewProps {
  tasks: Task[]
}

type Scale = 'Day' | 'Week'

const SCALE_PX_PER_DAY: Record<Scale, number> = { Day: 36, Week: 14 }
const LABEL_WIDTH = 200
const ROW_HEIGHT = 36
const HEADER_HEIGHT = 32

const PRIORITY_BAR_CLASS: Record<TaskPriority, string> = {
  low: 'bg-muted-foreground/50',
  medium: 'bg-secondary-foreground/60',
  high: 'bg-primary',
  urgent: 'bg-destructive',
}

interface GanttRow {
  task: Task
  startOffset: number // days from the visible range's start
  durationDays: number // inclusive span, at least 1
}

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function formatDayLabel(d: Date): string {
  return d.getDate() === 1
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : String(d.getDate())
}

export default function GanttView({ tasks }: GanttViewProps) {
  const [scale, setScale] = useState<Scale>('Day')
  const scrollRef = useRef<HTMLDivElement>(null)

  const scheduled = useMemo(() => tasks.filter((t) => t.startDate || t.dueDate), [tasks])
  const unscheduled = tasks.length - scheduled.length

  const { rows, days, todayOffset } = useMemo(() => {
    if (scheduled.length === 0) {
      return { rows: [] as GanttRow[], days: [] as Date[], todayOffset: -1 }
    }
    const starts = scheduled.map((t) => parseDate(t.startDate ?? t.dueDate!))
    const ends = scheduled.map((t) => parseDate(t.dueDate ?? t.startDate!))
    const rangeStart = addDays(new Date(Math.min(...starts.map((d) => d.getTime()))), -2)
    const rangeEnd = addDays(new Date(Math.max(...ends.map((d) => d.getTime()))), 2)
    const totalDays = daysBetween(rangeStart, rangeEnd) + 1

    const rows: GanttRow[] = scheduled.map((task) => {
      const start = parseDate(task.startDate ?? task.dueDate!)
      const end = parseDate(task.dueDate ?? task.startDate!)
      return {
        task,
        startOffset: daysBetween(rangeStart, start),
        durationDays: Math.max(1, daysBetween(start, end) + 1),
      }
    })

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return {
      rows,
      days: Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i)),
      todayOffset: daysBetween(rangeStart, today),
    }
  }, [scheduled])

  const pxPerDay = SCALE_PX_PER_DAY[scale]
  const totalDays = days.length
  const showTodayMarker = todayOffset >= 0 && todayOffset < totalDays

  function scrollToToday() {
    if (!scrollRef.current || !showTodayMarker) return
    const target = LABEL_WIDTH + todayOffset * pxPerDay - scrollRef.current.clientWidth / 2
    scrollRef.current.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }

  // Center on today whenever the chart (re)builds or the zoom level changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(scrollToToday, [totalDays, pxPerDay])

  if (scheduled.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No dated tasks to display yet — give a task a start or due date to see it here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={scrollToToday}
          disabled={!showTodayMarker}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          Today
        </button>
        <div className="flex overflow-hidden rounded-md border border-border">
          {(['Day', 'Week'] as Scale[]).map((s) => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                scale === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-border">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${LABEL_WIDTH}px repeat(${totalDays}, ${pxPerDay}px)`,
            gridTemplateRows: `${HEADER_HEIGHT}px repeat(${rows.length}, ${ROW_HEIGHT}px)`,
            width: LABEL_WIDTH + totalDays * pxPerDay,
          }}
        >
          <div
            className="sticky left-0 z-20 border-r border-b border-border bg-card"
            style={{ gridRow: 1, gridColumn: 1 }}
          />
          {days.map((d, i) => (
            <div
              key={i}
              className={`flex items-center justify-center border-b border-border text-[11px] ${
                d.getDay() === 0 || d.getDay() === 6 ? 'bg-muted text-muted-foreground' : 'text-foreground'
              }`}
              style={{ gridRow: 1, gridColumn: i + 2 }}
            >
              {formatDayLabel(d)}
            </div>
          ))}

          {showTodayMarker && (
            <div
              className="pointer-events-none justify-self-center bg-primary/60"
              style={{ gridRow: `1 / span ${rows.length + 1}`, gridColumn: todayOffset + 2, width: 2 }}
            />
          )}

          {rows.map((row, i) => (
            <GanttBarRow key={row.task.id} row={row} rowIndex={i + 2} totalDays={totalDays} pxPerDay={pxPerDay} />
          ))}
        </div>
      </div>

      {unscheduled > 0 && (
        <p className="text-xs text-muted-foreground">
          {unscheduled} task{unscheduled === 1 ? '' : 's'} without a date not shown.
        </p>
      )}
    </div>
  )
}

interface GanttBarRowProps {
  row: GanttRow
  rowIndex: number
  totalDays: number
  pxPerDay: number
}

function GanttBarRow({ row, rowIndex, totalDays, pxPerDay }: GanttBarRowProps) {
  const { task, startOffset, durationDays } = row
  return (
    <>
      <div
        className="sticky left-0 z-10 flex items-center truncate border-r border-b border-border bg-card px-2 text-xs font-medium text-foreground"
        style={{ gridRow: rowIndex, gridColumn: 1 }}
        title={task.title}
      >
        {task.title}
      </div>
      <div
        className="border-b border-border"
        style={{
          gridRow: rowIndex,
          gridColumn: `2 / span ${totalDays}`,
          backgroundImage: `repeating-linear-gradient(to right, transparent, transparent ${pxPerDay - 1}px, var(--color-border) ${pxPerDay - 1}px, var(--color-border) ${pxPerDay}px)`,
        }}
      />
      <div
        className={`m-1 overflow-hidden rounded ${PRIORITY_BAR_CLASS[task.priority]}`}
        style={{ gridRow: rowIndex, gridColumn: `${startOffset + 2} / span ${durationDays}` }}
        title={`${task.title} — ${task.progress}%`}
      >
        <div className="h-full bg-foreground/15" style={{ width: `${task.progress}%` }} />
      </div>
    </>
  )
}
