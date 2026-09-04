// Regression tests for bug C4 and its family.
//
// These only mean something in a timezone ahead of UTC — the whole bug was
// that a UTC round trip lost a day for such users, and every one of these
// assertions passes trivially when TZ=UTC. The suite runs with TZ pinned in
// package.json's test script; this guard makes the dependency explicit
// rather than letting the tests quietly become tautologies.
import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  formatISODate,
  parseISODate,
  shiftISODate,
  startOfWeek,
} from './task-dates'

const OFFSET_MINUTES = new Date('2026-09-30T00:00:00').getTimezoneOffset()

describe('timezone assumption', () => {
  it('runs ahead of UTC, where C4 actually reproduced', () => {
    // getTimezoneOffset is negative for zones ahead of UTC.
    expect(OFFSET_MINUTES).toBeLessThan(0)
  })
})

describe('parseISODate', () => {
  it('reads a date string as local midnight, not UTC midnight', () => {
    const d = parseISODate('2026-09-30')

    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8) // September
    expect(d.getDate()).toBe(30)
    expect(d.getHours()).toBe(0)
  })

  it('accepts the full datetime strings the API actually returns', () => {
    // Forgetting to slice this once produced silent Invalid Dates and a
    // blank Timeline.
    expect(parseISODate('2026-09-30T00:00:00').getDate()).toBe(30)
    expect(Number.isNaN(parseISODate('2026-09-30T00:00:00').getTime())).toBe(false)
  })
})

describe('formatISODate', () => {
  it('formats from local getters, so a local date survives the round trip', () => {
    expect(formatISODate(parseISODate('2026-09-30'))).toBe('2026-09-30')
  })

  it('does NOT agree with toISOString ahead of UTC — that gap was the bug', () => {
    const d = parseISODate('2026-10-01')

    expect(formatISODate(d)).toBe('2026-10-01')
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-30')
  })

  it('zero-pads single-digit months and days', () => {
    expect(formatISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('shiftISODate', () => {
  it('adds a day without slipping backwards (the exact C4 case)', () => {
    // FullCalendar's all-day `end` is exclusive, so a task due 2026-09-30
    // needs an end of 2026-10-01 to render its own due day. The old code
    // produced 2026-09-30 here and the day vanished from the grid.
    expect(shiftISODate('2026-09-30', 1)).toBe('2026-10-01')
  })

  it('crosses a year boundary', () => {
    expect(shiftISODate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(shiftISODate('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('goes backwards too', () => {
    expect(shiftISODate('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('survives a DST transition without drifting a day', () => {
    // Europe/Paris falls back on 2026-10-25. A naive +24h would land at
    // 23:00 the previous day; setDate keeps calendar-day semantics.
    expect(shiftISODate('2026-10-24', 1)).toBe('2026-10-25')
    expect(shiftISODate('2026-10-25', 1)).toBe('2026-10-26')
  })
})

describe('daysBetween', () => {
  it('counts whole days forwards', () => {
    expect(daysBetween(parseISODate('2026-09-01'), parseISODate('2026-09-04'))).toBe(3)
  })

  it('is negative when the second date is earlier', () => {
    expect(daysBetween(parseISODate('2026-09-04'), parseISODate('2026-09-01'))).toBe(-3)
  })

  it('rounds across a DST change rather than returning 0.958…', () => {
    expect(daysBetween(parseISODate('2026-10-24'), parseISODate('2026-10-26'))).toBe(2)
  })
})

describe('addDays', () => {
  it('does not mutate its argument', () => {
    const original = parseISODate('2026-09-30')
    addDays(original, 5)

    expect(formatISODate(original)).toBe('2026-09-30')
  })
})

describe('startOfWeek', () => {
  it('returns Monday for a mid-week date', () => {
    // 2026-09-30 is a Wednesday.
    expect(formatISODate(startOfWeek(parseISODate('2026-09-30')))).toBe('2026-09-28')
  })

  it('treats Sunday as the end of its week, not the start', () => {
    // 2026-10-04 is a Sunday; its Monday is 2026-09-28.
    expect(formatISODate(startOfWeek(parseISODate('2026-10-04')))).toBe('2026-09-28')
  })

  it('is idempotent on a Monday', () => {
    expect(formatISODate(startOfWeek(parseISODate('2026-09-28')))).toBe('2026-09-28')
  })
})
