// Gantt chart, hand-rolled with CSS Grid — no external Gantt library (see
// CLAUDE.md for why).
//
// Bars are always positioned at day granularity (one grid column per day,
// `pxPerDay` wide), so they stay pixel-accurate at any zoom level. What
// changes between Day/Week/Month is only how the header and the vertical
// divider lines are grouped — one cell per day, per week, or per month —
// so the chart doesn't turn into an illegible wall of 4px-wide day cells
// when zoomed out.
//
// Tasks with neither a start nor a due date can't be placed on a timeline
// and are simply not shown (count surfaced below the chart).
import { useEffect, useMemo, useRef, useState } from 'react'
import ShowCompletedToggle from '@/components/show-completed-toggle'
import TaskDetailDialog from '@/components/task-detail-dialog'
import { useShowCompleted } from '@/hooks/use-show-completed'
import type { Task, TaskPriority } from '@/types/task'

interface GanttViewProps {
  tasks: Task[]
}

type Scale = 'Day' | 'Week' | 'Month'

const SCALES: Scale[] = ['Day', 'Week', 'Month']
const SCALE_PX_PER_DAY: Record<Scale, number> = { Day: 36, Week: 14, Month: 5 }
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

interface HeaderGroup {
  startOffset: number
  spanDays: number
  label: string
}

function parseDate(iso: string): Date {
  // The backend returns full datetime strings ("2026-09-30T00:00:00"), not
  // bare dates — take just the date part, then force local-midnight parsing
  // (appending a bare "T00:00:00", with no timezone marker, is what makes
  // JS parse it as local time instead of UTC, avoiding an off-by-one-day
  // shift for users behind UTC).
  return new Date(`${iso.slice(0, 10)}T00:00:00`)
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function startOfWeek(d: Date): Date {
  const day = d.getDay() // 0 = Sunday .. 6 = Saturday
  return addDays(d, day === 0 ? -6 : 1 - day) // Monday-start week
}

function buildGroups(scale: Scale, rangeStart: Date, totalDays: number): HeaderGroup[] {
  if (scale === 'Day') {
    return Array.from({ length: totalDays }, (_, i) => {
      const d = addDays(rangeStart, i)
      return {
        startOffset: i,
        spanDays: 1,
        label: d.getDate() === 1 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : String(d.getDate()),
      }
    })
  }

  const groups: HeaderGroup[] = []

  if (scale === 'Week') {
    let cursor = startOfWeek(rangeStart)
    while (daysBetween(rangeStart, cursor) < totalDays) {
      const rawOffset = daysBetween(rangeStart, cursor)
      const startOffset = Math.max(rawOffset, 0)
      const endOffset = Math.min(rawOffset + 7, totalDays)
      if (endOffset > startOffset) {
        groups.push({
          startOffset,
          spanDays: endOffset - startOffset,
          label: addDays(rangeStart, startOffset).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        })
      }
      cursor = addDays(cursor, 7)
    }
    return groups
  }

  // Month
  let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  while (daysBetween(rangeStart, cursor) < totalDays) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const startOffset = Math.max(daysBetween(rangeStart, cursor), 0)
    const endOffset = Math.min(daysBetween(rangeStart, next), totalDays)
    if (endOffset > startOffset) {
      groups.push({
        startOffset,
        spanDays: endOffset - startOffset,
        label: cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      })
    }
    cursor = next
  }
  return groups
}

export default function GanttView({ tasks }: GanttViewProps) {
  const [scale, setScale] = useState<Scale>('Week')
  const scrollRef = useRef<HTMLDivElement>(null)
  const { showCompleted, toggle: toggleShowCompleted } = useShowCompleted('gantt')
  const [detailTask, setDetailTask] = useState<Task | null>(null)

  // Subtasks never appear here (only in Table, when expanded, and in
  // To-Do) — see CLAUDE.md.
  const topLevel = useMemo(() => tasks.filter((t) => t.parentId === null), [tasks])
  // Done tasks are hidden by default (see hooks/use-show-completed.ts) —
  // otherwise a finished task's bar sits on the timeline forever.
  const visible = useMemo(
    () => (showCompleted ? topLevel : topLevel.filter((t) => t.status !== 'done')),
    [topLevel, showCompleted],
  )
  const hiddenCount = topLevel.length - visible.length
  const scheduled = useMemo(() => visible.filter((t) => t.startDate || t.dueDate), [visible])
  const unscheduled = visible.length - scheduled.length

  const { rows, rangeStart, totalDays, todayOffset } = useMemo(() => {
    if (scheduled.length === 0) {
      return { rows: [] as GanttRow[], rangeStart: new Date(), totalDays: 0, todayOffset: -1 }
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

    return { rows, rangeStart, totalDays, todayOffset: daysBetween(rangeStart, today) }
  }, [scheduled])

  const pxPerDay = SCALE_PX_PER_DAY[scale]
  const groups = useMemo(() => buildGroups(scale, rangeStart, totalDays), [scale, rangeStart, totalDays])
  const showTodayMarker = todayOffset >= 0 && todayOffset < totalDays

  function scrollToToday() {
    if (!scrollRef.current || !showTodayMarker) return
    const target = LABEL_WIDTH + todayOffset * pxPerDay - scrollRef.current.clientWidth / 2
    scrollRef.current.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }

  // Center on today whenever the chart (re)builds or the zoom level changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(scrollToToday, [totalDays, pxPerDay])

  // A plain mouse wheel only ever produces vertical delta, and this widget
  // has nothing to scroll vertically — remap it to horizontal scroll so
  // wheel/trackpad users can actually move through the timeline.
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (e.deltaY === 0 || !scrollRef.current) return
    scrollRef.current.scrollLeft += e.deltaY
    e.preventDefault()
  }

  // Whether there's genuinely nothing to plot, independent of the
  // completed-tasks filter — vs. everything dated being done and hidden,
  // where the toggle below (needed to undo that) must still render.
  const noDatedTasksAtAll = topLevel.filter((t) => t.startDate || t.dueDate).length === 0

  if (noDatedTasksAtAll) {
    return (
      <p className="text-sm text-muted-foreground">
        No dated tasks to display yet — give a task a start or due date to see it here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-2">
        <ShowCompletedToggle
          showCompleted={showCompleted}
          hiddenCount={hiddenCount}
          onToggle={toggleShowCompleted}
        />
        <button
          onClick={scrollToToday}
          disabled={!showTodayMarker}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          Today
        </button>
        <div className="flex overflow-hidden rounded-md border border-border">
          {SCALES.map((s) => (
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

      {scheduled.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Every dated task is completed — "Show completed" above will bring them back.
        </p>
      ) : (
        <div
          ref={scrollRef}
          onWheel={handleWheel}
          className="overflow-x-auto rounded-lg border border-border"
        >
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
            {groups.map((g) => (
              <div
                key={g.startOffset}
                className="flex items-center justify-center overflow-hidden border-r border-b border-border px-1 text-[11px] text-foreground"
                style={{ gridRow: 1, gridColumn: `${g.startOffset + 2} / span ${g.spanDays}` }}
              >
                <span className="truncate">{g.label}</span>
              </div>
            ))}

            {showTodayMarker && (
              <div
                className="pointer-events-none justify-self-center bg-primary/60"
                style={{ gridRow: `1 / span ${rows.length + 1}`, gridColumn: todayOffset + 2, width: 2 }}
              />
            )}

            {rows.map((row, i) => (
              <GanttBarRow
                key={row.task.id}
                row={row}
                rowIndex={i + 2}
                groups={groups}
                onSelect={() => setDetailTask(row.task)}
              />
            ))}
          </div>
        </div>
      )}

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

interface GanttBarRowProps {
  row: GanttRow
  rowIndex: number
  groups: HeaderGroup[]
  onSelect: () => void
}

function GanttBarRow({ row, rowIndex, groups, onSelect }: GanttBarRowProps) {
  const { task, startOffset, durationDays } = row
  // Done overrides the priority color on both the label cell and the bar —
  // only reachable once "Show completed" reveals the row at all.
  const isDone = task.status === 'done'
  return (
    <>
      <div
        onClick={onSelect}
        className={`sticky left-0 z-10 flex cursor-pointer items-center truncate border-r border-b border-border px-2 text-xs font-medium text-foreground hover:brightness-95 ${
          isDone ? 'bg-done' : 'bg-card'
        }`}
        style={{ gridRow: rowIndex, gridColumn: 1 }}
        title={task.title}
      >
        {task.title}
      </div>
      {groups.map((g) => (
        <div
          key={g.startOffset}
          className="border-r border-b border-border"
          style={{ gridRow: rowIndex, gridColumn: `${g.startOffset + 2} / span ${g.spanDays}` }}
        />
      ))}
      <div
        onClick={onSelect}
        className={`m-1 cursor-pointer overflow-hidden rounded ${isDone ? 'bg-done' : PRIORITY_BAR_CLASS[task.priority]}`}
        style={{ gridRow: rowIndex, gridColumn: `${startOffset + 2} / span ${durationDays}` }}
        title={`${task.title} — ${task.progress}%`}
      >
        <div className="h-full bg-foreground/15" style={{ width: `${task.progress}%` }} />
      </div>
    </>
  )
}
