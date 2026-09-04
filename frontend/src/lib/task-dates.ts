// Date arithmetic shared by Calendar and Timeline.
//
// This module exists because the same handful of helpers were written twice,
// once per view, and bug C4 lived in one copy while the other had it right:
// Calendar built FullCalendar's exclusive `end` by parsing a date with
// `new Date(iso)` and formatting back through `.toISOString()`. The parse
// reads the API's timezone-less datetimes as *local* midnight; toISOString
// converts to *UTC*. For anyone ahead of UTC that round trip silently loses
// a day — a task due 2026-09-30 got an exclusive end of "2026-09-30", so the
// due date's own day never rendered at all (measured: a 3-day task drew a
// 2-day bar in a simulated Europe/Paris browser).
//
// The rule these functions encode, and the reason they are in one place:
// **parse as local midnight, format with local getters, never round-trip a
// date-only value through toISOString().**

/** Local midnight for a `YYYY-MM-DD` or a full API datetime string. */
export function parseISODate(iso: string): Date {
  // The bare "T00:00:00" with no timezone marker is what makes JS parse this
  // as local time. Slicing to 10 first also guards the other trap: the API
  // returns full datetimes ("2026-09-30T00:00:00"), and forgetting to slice
  // once produced silent Invalid Dates and a blank chart.
  return new Date(`${iso.slice(0, 10)}T00:00:00`)
}

/** `YYYY-MM-DD` from local getters — never toISOString(). */
export function formatISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

/** Whole days from `a` to `b`; negative when `b` precedes `a`. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** Shift a date string by whole days, staying in `YYYY-MM-DD`. */
export function shiftISODate(iso: string, days: number): string {
  return formatISODate(addDays(parseISODate(iso), days))
}

/** Monday-start week containing `d`. */
export function startOfWeek(d: Date): Date {
  const day = d.getDay() // 0 = Sunday .. 6 = Saturday
  return addDays(d, day === 0 ? -6 : 1 - day)
}

export function startOfToday(): Date {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  return t
}
