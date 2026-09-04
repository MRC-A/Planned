// Regression test for C4, at the level the bug actually manifested.
//
// The unit tests in lib/task-dates.test.ts cover the arithmetic; this covers
// the thing that was wrong on screen: FullCalendar's all-day `end` is
// exclusive, so a task due on the 30th needs an end of the 1st for the 30th
// itself to render. The old code produced the 30th, and the due date's own
// day silently vanished from the grid — measured at the time as a 3-day task
// drawing a 2-day bar.
import { describe, expect, it } from 'vitest'
import { dropPatch, resizePatch, toEvents } from './CalendarView'
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

// F7 — drag to reschedule (dropPatch) and drag-to-resize (resizePatch).
describe('dropPatch', () => {
  it('shifts both dates by the same delta, preserving the span', () => {
    const t = task({ startDate: '2026-09-08T00:00:00', dueDate: '2026-09-10T00:00:00' })

    expect(dropPatch(t, 5)).toEqual({ startDate: '2026-09-13', dueDate: '2026-09-15' })
  })

  it('does not invent a start date for a task that only had a due date', () => {
    const t = task({ dueDate: '2026-09-10T00:00:00' })

    expect(dropPatch(t, 3)).toEqual({ dueDate: '2026-09-13' })
  })

  it('does not invent a due date for a task that only had a start date', () => {
    const t = task({ startDate: '2026-09-10T00:00:00' })

    expect(dropPatch(t, 3)).toEqual({ startDate: '2026-09-13' })
  })

  it('shifts backwards for a negative delta', () => {
    const t = task({ startDate: '2026-09-10T00:00:00', dueDate: '2026-09-10T00:00:00' })

    expect(dropPatch(t, -2)).toEqual({ startDate: '2026-09-08', dueDate: '2026-09-08' })
  })

  it('crosses a month boundary without drift', () => {
    const t = task({ dueDate: '2026-09-29T00:00:00' })

    expect(dropPatch(t, 3)).toEqual({ dueDate: '2026-10-02' })
  })
})

describe('resizePatch', () => {
  it('converts the exclusive end back to an inclusive due date', () => {
    // FullCalendar hands back the day AFTER the last visible day.
    const patch = resizePatch(new Date(2026, 8, 8), new Date(2026, 8, 12))

    expect(patch).toEqual({ startDate: '2026-09-08', dueDate: '2026-09-11' })
  })

  it('falls back to a single-day span when there is no end at all', () => {
    expect(resizePatch(new Date(2026, 8, 8), null)).toEqual({
      startDate: '2026-09-08',
      dueDate: '2026-09-08',
    })
  })

  it('always sets both dates explicitly, unlike a move', () => {
    // A resize defines a real range regardless of what the task had before —
    // this is the one place both ends are always written.
    const patch = resizePatch(new Date(2026, 8, 8), new Date(2026, 8, 9))

    expect(Object.keys(patch).sort()).toEqual(['dueDate', 'startDate'])
  })
})
