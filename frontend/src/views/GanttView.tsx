// Gantt chart: tasks with a start and/or due date become timeline bars,
// dependencies become arrows. Tasks without any date can't be placed on a
// timeline and are simply not shown.
import { useEffect, useRef } from 'react'
import Gantt, { type GanttTask } from 'frappe-gantt'
import 'frappe-gantt/dist/frappe-gantt.css'
import '@/styles/gantt.css'
import type { Task } from '@/types/task'

interface GanttViewProps {
  tasks: Task[]
}

function toGanttTasks(tasks: Task[]): GanttTask[] {
  const scheduled = new Set(tasks.filter((t) => t.startDate || t.dueDate).map((t) => t.id))
  return tasks
    .filter((t) => t.startDate || t.dueDate)
    .map((t) => ({
      id: String(t.id),
      name: t.title,
      start: t.startDate ?? t.dueDate!,
      end: t.dueDate ?? t.startDate!,
      progress: t.progress,
      // Dependencies on an unscheduled task can't be drawn — drop them.
      dependencies: t.dependsOn !== null && scheduled.has(t.dependsOn) ? String(t.dependsOn) : '',
    }))
}

export default function GanttView({ tasks }: GanttViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Gantt | null>(null)
  const ganttTasks = toGanttTasks(tasks)
  const unscheduled = tasks.length - ganttTasks.length

  useEffect(() => {
    if (!containerRef.current || ganttTasks.length === 0) return
    if (!chartRef.current) {
      chartRef.current = new Gantt(containerRef.current, ganttTasks, {
        view_mode: 'Week',
        today_button: true,
      })
    } else {
      chartRef.current.refresh(ganttTasks)
    }
    // Tasks are re-derived every render; compare by value so the chart only
    // rebuilds/refreshes when the underlying data actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(ganttTasks)])

  useEffect(() => {
    const container = containerRef.current
    return () => {
      if (container) container.innerHTML = ''
      chartRef.current = null
    }
  }, [])

  if (ganttTasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No dated tasks to display yet — give a task a start or due date to see it here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={containerRef} />
      {unscheduled > 0 && (
        <p className="text-xs text-muted-foreground">
          {unscheduled} task{unscheduled === 1 ? '' : 's'} without a date not shown.
        </p>
      )}
    </div>
  )
}
