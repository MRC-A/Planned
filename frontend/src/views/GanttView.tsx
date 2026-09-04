// Timeline view — tasks as rows, time running across the top.
//
// Deliberately NOT a strict Gantt any more (no dependency arrows, no
// critical path, no % complete). The strict reading made it useless against
// real data: it plotted only top-level tasks that already had dates, which
// in practice meant 3 rows out of 40. What it is now is "my tasks as rows,
// laid out over time", which is what the view is actually for:
//
//   - subtasks get rows too, indented under their parent (Calendar still
//     filters them out; this view no longer does — see CLAUDE.md);
//   - a parent with no dates of its own is drawn as a thin rollup bar
//     spanning its children, so the hierarchy still reads at a glance;
//   - undated tasks are NOT silently dropped — they sit in a tray under the
//     chart and can be dragged onto it to schedule them;
//   - a scheduled bar can be dragged to reschedule, or grabbed by either
//     edge to change its span.
//
// The chart is its own scroll container in both axes, so the date header
// stays put vertically and the task-name column stays put horizontally.
import { useEffect, useMemo, useRef, useState } from 'react'
import ShowCompletedToggle from '@/components/show-completed-toggle'
import TaskDetailDialog from '@/components/task-detail-dialog'
import { useShowCompleted } from '@/hooks/use-show-completed'
import type { Task, TaskPatch, TaskPriority } from '@/types/task'

interface GanttViewProps {
  tasks: Task[]
  onEdit: (id: number, patch: TaskPatch) => Promise<void>
}

type Scale = 'Day' | 'Week' | 'Month'

const SCALES: Scale[] = ['Day', 'Week', 'Month']
const SCALE_PX_PER_DAY: Record<Scale, number> = { Day: 40, Week: 18, Month: 7 }
const LABEL_WIDTH = 240
const ROW_HEIGHT = 32
const HEADER_BAND = 24
// Forward room kept beyond the last known date, so there's somewhere to drop
// an unscheduled task without having to scroll the range into existence.
const PAD_BEFORE = 14
const PAD_AFTER = 60

const PRIORITY_BAR_CLASS: Record<TaskPriority, string> = {
  low: 'bg-muted-foreground/50',
  medium: 'bg-secondary-foreground/60',
  high: 'bg-primary',
  urgent: 'bg-destructive',
}

interface Span {
  start: Date
  end: Date
  kind: 'own' | 'rollup'
}

interface TimelineRow {
  task: Task
  depth: 0 | 1
  kind: 'own' | 'rollup'
  startOffset: number
  spanDays: number
  collapsible: boolean
}

interface HeaderGroup {
  startOffset: number
  spanDays: number
  label: string
}

/** Drag in flight. `origin` is the task's span when the drag started. */
interface DragPreview {
  taskId: number
  mode: 'move' | 'start' | 'end' | 'schedule'
  deltaDays: number
  // 'schedule' only — where the cursor is, for the floating ghost.
  pointer?: { x: number; y: number }
  dayIndex?: number | null
}

function parseDate(iso: string): Date {
  // The backend returns full datetime strings ("2026-09-30T00:00:00"): take
  // the date part and force local-midnight parsing. Never round-trip through
  // toISOString() here — that's the C4 bug (see CLAUDE.md).
  return new Date(`${iso.slice(0, 10)}T00:00:00`)
}

/** YYYY-MM-DD from local getters — same reason as above. */
function formatISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

function startOfToday(): Date {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}

/**
 * The span a task occupies on its own. A task with only one of the two dates
 * is a single day on that date; a task whose due date precedes its start is
 * read in the order that makes a span rather than being dropped.
 */
function ownSpan(t: Task): Span | null {
  if (!t.startDate && !t.dueDate) return null
  const a = parseDate(t.startDate ?? t.dueDate!)
  const b = parseDate(t.dueDate ?? t.startDate!)
  return b < a ? { start: b, end: a, kind: 'own' } : { start: a, end: b, kind: 'own' }
}

function buildGroups(scale: Scale, rangeStart: Date, totalDays: number): HeaderGroup[] {
  if (scale === 'Day') {
    return Array.from({ length: totalDays }, (_, i) => ({
      startOffset: i,
      spanDays: 1,
      label: String(addDays(rangeStart, i).getDate()),
    }))
  }

  const groups: HeaderGroup[] = []

  if (scale === 'Week') {
    let cursor = startOfWeek(rangeStart)
    while (daysBetween(rangeStart, cursor) < totalDays) {
      const raw = daysBetween(rangeStart, cursor)
      const startOffset = Math.max(raw, 0)
      const endOffset = Math.min(raw + 7, totalDays)
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

  let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1)
  while (daysBetween(rangeStart, cursor) < totalDays) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    const startOffset = Math.max(daysBetween(rangeStart, cursor), 0)
    const endOffset = Math.min(daysBetween(rangeStart, next), totalDays)
    if (endOffset > startOffset) {
      groups.push({
        startOffset,
        spanDays: endOffset - startOffset,
        label: cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      })
    }
    cursor = next
  }
  return groups
}

/** Month bands for the upper header tier (redundant at Month zoom). */
function buildMonthBands(rangeStart: Date, totalDays: number): HeaderGroup[] {
  return buildGroups('Month', rangeStart, totalDays).map((g) => ({
    ...g,
    label: addDays(rangeStart, g.startOffset).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  }))
}

export default function GanttView({ tasks, onEdit }: GanttViewProps) {
  const [scale, setScale] = useState<Scale>('Week')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [drag, setDrag] = useState<DragPreview | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const { showCompleted, toggle: toggleShowCompleted } = useShowCompleted('gantt')

  const scrollRef = useRef<HTMLDivElement>(null)
  // Set while a pointer drag actually moved, so the click that ends the drag
  // doesn't also open the detail dialog.
  const draggedRef = useRef(false)

  const pxPerDay = SCALE_PX_PER_DAY[scale]

  // Keep the chart at least as wide as its container — the old version sized
  // itself purely to the data, so three same-week tasks rendered as a 326px
  // box marooned in the corner of the page.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Done tasks are hidden by default (see hooks/use-show-completed.ts).
  const visible = useMemo(
    () => (showCompleted ? tasks : tasks.filter((t) => t.status !== 'done')),
    [tasks, showCompleted],
  )
  const hiddenCount = tasks.length - visible.length

  const { rows, tray, rangeStart, totalDays, todayOffset } = useMemo(() => {
    // 1. Where each task sits, on its own dates or rolled up from children.
    const spans = new Map<number, Span>()
    for (const t of visible) {
      const own = ownSpan(t)
      if (own) spans.set(t.id, own)
    }
    const childrenOf = new Map<number, Task[]>()
    for (const t of visible) {
      if (t.parentId === null) continue
      const list = childrenOf.get(t.parentId)
      if (list) list.push(t)
      else childrenOf.set(t.parentId, [t])
    }
    const visibleIds = new Set(visible.map((t) => t.id))
    for (const [parentId, children] of childrenOf) {
      // A child whose parent is filtered out (done, hidden) gets promoted to
      // its own row further down — don't invent a rollup for a parent that
      // isn't on the chart.
      if (!visibleIds.has(parentId) || spans.has(parentId)) continue
      const spanned = children.map((c) => spans.get(c.id)).filter((s): s is Span => !!s)
      if (spanned.length === 0) continue
      spans.set(parentId, {
        start: new Date(Math.min(...spanned.map((s) => s.start.getTime()))),
        end: new Date(Math.max(...spanned.map((s) => s.end.getTime()))),
        kind: 'rollup',
      })
    }

    // 2. The date range, always including today so "now" is on screen even
    //    when nothing is scheduled yet.
    const today = startOfToday()
    const all = [...spans.values()]
    const min = all.length ? new Date(Math.min(...all.map((s) => s.start.getTime()), today.getTime())) : today
    const max = all.length ? new Date(Math.max(...all.map((s) => s.end.getTime()), today.getTime())) : today
    const rangeStart = addDays(min, -PAD_BEFORE)
    const dataDays = daysBetween(rangeStart, addDays(max, PAD_AFTER)) + 1
    const fillDays = Math.ceil(Math.max(viewportWidth - LABEL_WIDTH, 600) / pxPerDay)
    const totalDays = Math.max(dataDays, fillDays)

    // 3. Rows, parents first with their scheduled children indented under
    //    them. A scheduled child whose parent is hidden (done, filtered out)
    //    is promoted to a standalone row rather than disappearing.
    const place = (task: Task, depth: 0 | 1, collapsible: boolean): TimelineRow => {
      const s = spans.get(task.id)!
      return {
        task,
        depth,
        kind: s.kind,
        startOffset: daysBetween(rangeStart, s.start),
        spanDays: Math.max(1, daysBetween(s.start, s.end) + 1),
        collapsible,
      }
    }
    const rows: TimelineRow[] = []
    const seen = new Set<number>()
    for (const t of visible) {
      if (t.parentId !== null || !spans.has(t.id)) continue
      const kids = (childrenOf.get(t.id) ?? []).filter((c) => spans.has(c.id))
      rows.push(place(t, 0, kids.length > 0))
      seen.add(t.id)
      // Mark the children handled whether or not they're rendered: the
      // promotion pass below exists for children whose parent isn't on the
      // chart at all, and without this a collapsed parent's children came
      // straight back as top-level rows (collapsing appeared to do nothing).
      for (const c of kids) seen.add(c.id)
      if (collapsed.has(t.id)) continue
      for (const c of kids) rows.push(place(c, 1, false))
    }
    for (const t of visible) {
      if (t.parentId === null || !spans.has(t.id) || seen.has(t.id)) continue
      rows.push(place(t, 0, false))
      seen.add(t.id)
    }

    // 4. Everything with no placement at all goes to the tray. A parent with
    //    a rollup is already on the chart, so it isn't listed twice.
    const tray = visible.filter((t) => !spans.has(t.id))

    return { rows, tray, rangeStart, totalDays, todayOffset: daysBetween(rangeStart, today) }
  }, [visible, collapsed, viewportWidth, pxPerDay])

  const groups = useMemo(() => buildGroups(scale, rangeStart, totalDays), [scale, rangeStart, totalDays])
  const monthBands = useMemo(
    () => (scale === 'Month' ? [] : buildMonthBands(rangeStart, totalDays)),
    [scale, rangeStart, totalDays],
  )
  const headerRows = scale === 'Month' ? 1 : 2
  const firstDataRow = headerRows + 1
  const showTodayMarker = todayOffset >= 0 && todayOffset < totalDays

  function scrollToToday() {
    const el = scrollRef.current
    if (!el || !showTodayMarker) return
    el.scrollTo({ left: Math.max(0, LABEL_WIDTH + todayOffset * pxPerDay - el.clientWidth / 2), behavior: 'smooth' })
  }

  // Center on today when the chart is first laid out and whenever the zoom
  // changes (the pixel position of "today" moves with pxPerDay).
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !showTodayMarker) return
    el.scrollLeft = Math.max(0, LABEL_WIDTH + todayOffset * pxPerDay - el.clientWidth / 2)
    // Only on zoom / first layout — not on every date edit, which would yank
    // the viewport back to today after each drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerDay, viewportWidth > 0])

  /** Day column under a viewport x coordinate, or null if over the labels. */
  function dayIndexAt(clientX: number): number | null {
    const el = scrollRef.current
    if (!el) return null
    const contentX = clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_WIDTH
    if (contentX < 0) return null
    const i = Math.floor(contentX / pxPerDay)
    return i >= 0 && i < totalDays ? i : null
  }

  async function commit(id: number, patch: TaskPatch) {
    setActionError(null)
    try {
      await onEdit(id, patch)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that change.')
    }
  }

  // --- Dragging -----------------------------------------------------------
  // Window-level listeners registered per gesture (and torn down by the
  // pointerup that ends it), so the pointer can leave the bar mid-drag
  // without the gesture dying.

  function beginBarDrag(e: React.PointerEvent, row: TimelineRow, mode: 'move' | 'start' | 'end') {
    if (row.kind === 'rollup') return // a rollup has no dates of its own to move
    e.preventDefault()
    e.stopPropagation()
    const originX = e.clientX
    const { startOffset, spanDays } = row
    draggedRef.current = false

    const clampDelta = (raw: number) => {
      if (mode === 'move') return Math.max(-startOffset, Math.min(raw, totalDays - spanDays - startOffset))
      if (mode === 'start') return Math.max(-startOffset, Math.min(raw, spanDays - 1))
      return Math.max(-(spanDays - 1), Math.min(raw, totalDays - (startOffset + spanDays)))
    }

    const onMove = (ev: PointerEvent) => {
      const delta = clampDelta(Math.round((ev.clientX - originX) / pxPerDay))
      if (delta !== 0) draggedRef.current = true
      setDrag({ taskId: row.task.id, mode, deltaDays: delta })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDrag(null)
      const delta = clampDelta(Math.round((ev.clientX - originX) / pxPerDay))
      if (delta === 0) return
      const span = ownSpan(row.task)
      if (!span) return
      if (mode === 'move') {
        commit(row.task.id, {
          startDate: formatISODate(addDays(span.start, delta)),
          dueDate: formatISODate(addDays(span.end, delta)),
        })
      } else if (mode === 'start') {
        commit(row.task.id, { startDate: formatISODate(addDays(span.start, delta)) })
      } else {
        commit(row.task.id, { dueDate: formatISODate(addDays(span.end, delta)) })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function beginTrayDrag(e: React.PointerEvent, task: Task) {
    e.preventDefault()
    draggedRef.current = false
    setDrag({ taskId: task.id, mode: 'schedule', deltaDays: 0, pointer: { x: e.clientX, y: e.clientY }, dayIndex: null })

    const onMove = (ev: PointerEvent) => {
      draggedRef.current = true
      setDrag({
        taskId: task.id,
        mode: 'schedule',
        deltaDays: 0,
        pointer: { x: ev.clientX, y: ev.clientY },
        dayIndex: dayIndexAt(ev.clientX),
      })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDrag(null)
      const day = dayIndexAt(ev.clientX)
      // Only a drop that landed on the chart schedules anything; releasing
      // over the tray or outside is a cancel, not a silent no-op edit.
      const el = scrollRef.current
      const overChart = el ? ev.clientY >= el.getBoundingClientRect().top && ev.clientY <= el.getBoundingClientRect().bottom : false
      if (day === null || !overChart) return
      const iso = formatISODate(addDays(rangeStart, day))
      commit(task.id, { startDate: iso, dueDate: iso })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Row geometry with the in-flight drag applied, for live feedback. */
  function previewed(row: TimelineRow): { startOffset: number; spanDays: number } {
    if (!drag || drag.taskId !== row.task.id || drag.mode === 'schedule') return row
    const { startOffset, spanDays } = row
    const d = drag.deltaDays
    if (drag.mode === 'move') return { startOffset: startOffset + d, spanDays }
    if (drag.mode === 'start') return { startOffset: startOffset + d, spanDays: spanDays - d }
    return { startOffset, spanDays: spanDays + d }
  }

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openDetail(task: Task) {
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    setDetailTask(task)
  }

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks yet — create one to see it on the timeline.</p>
  }

  const gridWidth = LABEL_WIDTH + totalDays * pxPerDay
  const dragTask = drag?.mode === 'schedule' ? tray.find((t) => t.id === drag.taskId) : undefined

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ShowCompletedToggle showCompleted={showCompleted} hiddenCount={hiddenCount} onToggle={toggleShowCompleted} />
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

      {actionError && <p className="text-xs text-destructive">{actionError}</p>}

      <div
        ref={scrollRef}
        className="relative max-h-[65vh] overflow-auto rounded-lg border border-border"
        style={{ touchAction: drag ? 'none' : undefined }}
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `${LABEL_WIDTH}px repeat(${totalDays}, ${pxPerDay}px)`,
            gridTemplateRows: `repeat(${headerRows}, ${HEADER_BAND}px) repeat(${rows.length}, ${ROW_HEIGHT}px)`,
            width: gridWidth,
          }}
        >
          {/* Sticky corner, above both the header and the label column. */}
          <div
            className="sticky top-0 left-0 z-30 flex items-center border-r border-b border-border bg-card px-2 text-[11px] font-medium text-muted-foreground"
            style={{ gridRow: `1 / span ${headerRows}`, gridColumn: 1 }}
          >
            {rows.length} on the timeline
          </div>

          {monthBands.map((b) => (
            <div
              key={`m${b.startOffset}`}
              className="sticky top-0 z-20 flex items-center border-r border-b border-border bg-card px-2 text-[11px] font-semibold text-foreground"
              style={{ gridRow: 1, gridColumn: `${b.startOffset + 2} / span ${b.spanDays}` }}
            >
              {/* Pinned just right of the label column so the month you're
                  looking at stays named while you scroll through it, instead
                  of its label sliding off to the left. The clipping lives on
                  this span (max-w-full + truncate) rather than on the cell:
                  an ancestor with overflow-hidden cancels a descendant's
                  sticky outright, which is why the cell can't carry it. */}
              <span className="sticky max-w-full truncate" style={{ left: LABEL_WIDTH + 8 }}>
                {b.label}
              </span>
            </div>
          ))}

          {groups.map((g) => (
            <div
              key={`g${g.startOffset}`}
              className="sticky z-20 flex items-center justify-center overflow-hidden border-r border-b border-border bg-card px-1 text-[11px] text-muted-foreground"
              style={{
                gridRow: headerRows,
                gridColumn: `${g.startOffset + 2} / span ${g.spanDays}`,
                top: headerRows === 2 ? HEADER_BAND : 0,
              }}
            >
              <span className="truncate">{g.label}</span>
            </div>
          ))}

          {/* Column dividers as one background layer spanning every row,
              rather than re-rendering a cell per group per row (which was
              rows x groups divs — thousands of them on a real backlog). */}
          {rows.length > 0 &&
            groups.map((g) => (
              <div
                key={`d${g.startOffset}`}
                className="pointer-events-none border-r border-border/60"
                style={{
                  gridRow: `${firstDataRow} / span ${rows.length}`,
                  gridColumn: `${g.startOffset + 2} / span ${g.spanDays}`,
                }}
              />
            ))}

          {/* Weekend shading, only where a day column is wide enough to read. */}
          {rows.length > 0 &&
            pxPerDay >= 12 &&
            Array.from({ length: totalDays }, (_, i) => i)
              .filter((i) => [0, 6].includes(addDays(rangeStart, i).getDay()))
              .map((i) => (
                <div
                  key={`w${i}`}
                  className="pointer-events-none bg-muted/50"
                  style={{ gridRow: `${firstDataRow} / span ${rows.length}`, gridColumn: i + 2 }}
                />
              ))}

          {showTodayMarker && rows.length > 0 && (
            <div
              className="pointer-events-none justify-self-start bg-primary/70"
              style={{ gridRow: `${firstDataRow} / span ${rows.length}`, gridColumn: todayOffset + 2, width: 2 }}
            />
          )}

          {/* Drop target highlight while dragging a tray task in. */}
          {drag?.mode === 'schedule' && drag.dayIndex !== null && drag.dayIndex !== undefined && rows.length > 0 && (
            <div
              className="pointer-events-none bg-primary/25 ring-1 ring-primary"
              style={{ gridRow: `${firstDataRow} / span ${rows.length}`, gridColumn: drag.dayIndex + 2 }}
            />
          )}

          {rows.map((row, i) => {
            const geom = previewed(row)
            const isDone = row.task.status === 'done'
            const isRollup = row.kind === 'rollup'
            const barWidth = geom.spanDays * pxPerDay
            const dragging = drag?.taskId === row.task.id && drag.mode !== 'schedule'
            return (
              <div key={row.task.id} className="contents">
                <div
                  onClick={() => openDetail(row.task)}
                  className={`sticky left-0 z-10 flex cursor-pointer items-center gap-1 border-r border-b border-border px-2 text-xs text-foreground hover:brightness-95 ${
                    isDone ? 'bg-done' : 'bg-card'
                  } ${row.depth === 1 ? 'pl-6' : ''}`}
                  style={{ gridRow: firstDataRow + i, gridColumn: 1 }}
                  title={row.task.title}
                >
                  {row.collapsible ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleCollapse(row.task.id)
                      }}
                      className="shrink-0 rounded px-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={collapsed.has(row.task.id) ? 'Expand subtasks' : 'Collapse subtasks'}
                    >
                      {collapsed.has(row.task.id) ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className={`truncate ${row.depth === 0 ? 'font-medium' : 'text-muted-foreground'}`}>
                    {row.task.title}
                  </span>
                </div>

                <div
                  className="border-b border-border"
                  style={{ gridRow: firstDataRow + i, gridColumn: `2 / span ${totalDays}` }}
                />

                <div
                  data-bar={row.task.id}
                  onClick={() => openDetail(row.task)}
                  onPointerDown={(e) => beginBarDrag(e, row, 'move')}
                  className={`group relative my-1 flex items-center rounded ${
                    isRollup
                      ? 'h-1.5 self-center cursor-pointer bg-muted-foreground/40'
                      : `cursor-grab ${isDone ? 'bg-done' : PRIORITY_BAR_CLASS[row.task.priority]} ${
                          dragging ? 'opacity-80 ring-2 ring-ring' : ''
                        }`
                  }`}
                  style={{
                    gridRow: firstDataRow + i,
                    gridColumn: `${geom.startOffset + 2} / span ${Math.max(1, geom.spanDays)}`,
                  }}
                  title={`${row.task.title}\n${formatISODate(addDays(rangeStart, geom.startOffset))} → ${formatISODate(
                    addDays(rangeStart, geom.startOffset + geom.spanDays - 1),
                  )}${isRollup ? '\n(rolled up from subtasks)' : ''}`}
                >
                  {!isRollup && barWidth >= 28 && (
                    <>
                      <span
                        onPointerDown={(e) => beginBarDrag(e, row, 'start')}
                        className="absolute left-0 h-full w-1.5 cursor-ew-resize rounded-l opacity-0 group-hover:opacity-100 bg-foreground/30"
                      />
                      <span
                        onPointerDown={(e) => beginBarDrag(e, row, 'end')}
                        className="absolute right-0 h-full w-1.5 cursor-ew-resize rounded-r opacity-0 group-hover:opacity-100 bg-foreground/30"
                      />
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {rows.length === 0 && (
          <p className="absolute inset-x-0 top-1/2 text-center text-sm text-muted-foreground">
            Nothing scheduled yet — drag a task from below onto a day.
          </p>
        )}
      </div>

      {tray.length > 0 && (
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Not scheduled ({tray.length}) — drag one onto the timeline to give it a date
          </p>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {tray.map((t) => (
              <button
                key={t.id}
                data-pill={t.id}
                onPointerDown={(e) => beginTrayDrag(e, t)}
                onClick={() => openDetail(t)}
                className={`max-w-[240px] cursor-grab truncate rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:bg-muted ${
                  drag?.taskId === t.id && drag.mode === 'schedule' ? 'opacity-40' : ''
                } ${t.status === 'done' ? 'bg-done' : 'bg-card'}`}
                title={t.title}
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Ghost following the cursor while a tray task is being dragged in. */}
      {drag?.mode === 'schedule' && drag.pointer && dragTask && (
        <div
          className="pointer-events-none fixed z-50 max-w-[240px] truncate rounded-full border border-primary bg-card px-2.5 py-1 text-xs shadow-lg"
          style={{ left: drag.pointer.x + 12, top: drag.pointer.y + 12 }}
        >
          {dragTask.title}
          {drag.dayIndex !== null && drag.dayIndex !== undefined && (
            <span className="ml-1.5 text-muted-foreground">
              → {formatISODate(addDays(rangeStart, drag.dayIndex))}
            </span>
          )}
        </div>
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
