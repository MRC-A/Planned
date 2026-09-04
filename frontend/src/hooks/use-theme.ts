// The light/dark preference, persisted across reloads. Three states rather
// than a binary toggle: "system" (the default) follows the OS setting and
// keeps following it as it changes, while "light"/"dark" pin the choice
// regardless of the OS.
//
// The resolved theme is applied by toggling the `dark` class on <html> —
// that's what index.css's `@custom-variant dark (&:is(.dark *))` and its
// `.dark` token block key off, so every `--color-*` token (and therefore
// every view, including the real CSS color strings in task-display.ts and
// the FullCalendar overrides in styles/calendar.css) follows automatically.
// index.html runs the same resolution inline before first paint to avoid a
// flash of the light theme — keep the storage key and the rule below in
// sync with that script.
import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'planned:theme'
const CYCLE: ThemePreference[] = ['system', 'light', 'dark']

function readStored(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'system' || raw === 'light' || raw === 'dark') return raw
  } catch {
    // Private browsing / storage disabled — falls back to session-only
    // state starting from the default, same as use-show-completed.ts.
  }
  return 'system'
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(readStored)
  const [systemDark, setSystemDark] = useState<boolean>(prefersDark)

  // Keep following the OS while the preference is "system" — a desktop
  // switching to dark at sunset should carry over without a reload.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [resolved])

  const cycle = useCallback(() => {
    setTheme((prev) => {
      const next = CYCLE[(CYCLE.indexOf(prev) + 1) % CYCLE.length]
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore — see readStored
      }
      return next
    })
  }, [])

  return { theme, resolved, cycle }
}
