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

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
