// Shared label/formatting helpers so the Table and To-Do views render task
// fields consistently.

import type { TaskPriority, TaskStatus } from '@/types/task'

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export const PRIORITY_BADGE_VARIANT: Record<TaskPriority, 'outline' | 'secondary' | 'default' | 'destructive'> = {
  low: 'outline',
  medium: 'secondary',
  high: 'default',
  urgent: 'destructive',
}

// Real CSS color values (not Tailwind classes) for contexts that need one —
// e.g. FullCalendar's event backgroundColor/textColor props. Kept in sync
// with PRIORITY_BADGE_VARIANT's palette.
export const PRIORITY_BG_COLOR: Record<TaskPriority, string> = {
  low: 'var(--color-muted)',
  medium: 'var(--color-secondary)',
  high: 'var(--color-primary)',
  urgent: 'var(--color-destructive)',
}

export const PRIORITY_TEXT_COLOR: Record<TaskPriority, string> = {
  low: 'var(--color-foreground)',
  medium: 'var(--color-secondary-foreground)',
  high: 'var(--color-primary-foreground)',
  urgent: 'var(--color-primary-foreground)',
}

// Higher number = more urgent, for sorting.
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 3,
  high: 2,
  medium: 1,
  low: 0,
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

export const STATUS_BADGE_VARIANT: Record<TaskStatus, 'outline' | 'secondary' | 'default'> = {
  todo: 'outline',
  in_progress: 'default',
  done: 'secondary',
}

// Slightly-green background so a completed task stands out at a glance
// wherever it's shown (Table, To-Do, Calendar, Gantt — hidden by default in
// all of them, see hooks/use-show-completed.ts). Table/To-Do/Gantt apply
// this as the `done`/`done-foreground` Tailwind classes directly; Calendar
// needs real CSS color strings instead, for FullCalendar's
// backgroundColor/textColor event props (see PRIORITY_BG_COLOR above) —
// these two constants are that pair, overriding the priority colors when a
// task is done.
export const DONE_BG_COLOR = 'var(--color-done)'
export const DONE_TEXT_COLOR = 'var(--color-done-foreground)'

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
