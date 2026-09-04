// Regression test for C4, at the level the bug actually manifested.
//
// The unit tests in lib/task-dates.test.ts cover the arithmetic; this covers
// the thing that was wrong on screen: FullCalendar's all-day `end` is
// exclusive, so a task due on the 30th needs an end of the 1st for the 30th
// itself to render. The old code produced the 30th, and the due date's own
// day silently vanished from the grid — measured at the time as a 3-day task
// drawing a 2-day bar.
import { describe, expect, it } from 'vitest'
import { toEvents } from './CalendarView'
import type { Task } from '@/types/task'

function task(fields: Partial<Task>): Task {
  return {
    id: 1,
    title: 'A task',
    description: '',
    status: 'todo',
    priority: 'medium',
    startDate: null,
    dueDate: null,
    durationHours: null,
    dependsOn: null,
    parentId: null,
    tags: [],
    recurrence: null,
    createdAt: '2026-09-01T00:00:00',
    updatedAt: '2026-09-01T00:00:00',
    ...fields,
  }
}

describe('toEvents', () => {
  it('makes the exclusive end cover the due date itself', () => {
    const [event] = toEvents([
      task({ startDate: '2026-09-28T00:00:00', dueDate: '2026-09-30T00:00:00' }),
    ])

    expect(event.start).toBe('2026-09-28')
    expect(event.end).toBe('2026-10-01') // was 2026-09-30 — the C4 bug
  })

  it('spans the right number of days', () => {
    const [event] = toEvents([
      task({ startDate: '2026-09-28T00:00:00', dueDate: '2026-09-30T00:00:00' }),
    ])
    const days =
      (new Date(`${event.end}T00:00:00`).getTime() - new Date(`${event.start}T00:00:00`).getTime()) /
      86_400_000

    expect(days).toBe(3) // was 2
  })

  it('gives a single-day event to a task with only a due date', () => {
    const [event] = toEvents([task({ dueDate: '2026-09-30T00:00:00' })])

    expect(event.start).toBe('2026-09-30')
    expect(event.end).toBe('2026-10-01')
  })

  it('gives a single-day event to a task with only a start date', () => {
    const [event] = toEvents([task({ startDate: '2026-09-30T00:00:00' })])

    expect(event.start).toBe('2026-09-30')
    expect(event.end).toBe('2026-10-01')
  })

  it('feeds FullCalendar bare dates, never time-bearing strings', () => {
    // Handing FullCalendar a datetime lets it do its own parsing, which is a
    // second place the same class of timezone bug could hide.
    const [event] = toEvents([
      task({ startDate: '2026-09-28T00:00:00', dueDate: '2026-09-30T00:00:00' }),
    ])

    expect(event.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(event.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(event.allDay).toBe(true)
  })

  it('skips tasks with no dates at all', () => {
    expect(toEvents([task({}), task({ id: 2, dueDate: '2026-09-30T00:00:00' })])).toHaveLength(1)
  })

  it('crosses a month boundary correctly', () => {
    const [event] = toEvents([
      task({ startDate: '2026-10-30T00:00:00', dueDate: '2026-10-31T00:00:00' }),
    ])

    expect(event.end).toBe('2026-11-01')
  })
})
