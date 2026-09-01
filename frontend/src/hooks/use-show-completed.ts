// Whether a view should show its "done" tasks — hidden by default, and
// remembered independently per view (Table hiding done tasks doesn't
// affect Calendar's own toggle) via localStorage, so the choice survives a
// reload. `view` is just a namespacing key ("table", "todo", "calendar",
// "gantt").
import { useState } from 'react'

function storageKey(view: string): string {
  return `planned:showCompleted:${view}`
}

export function useShowCompleted(view: string) {
  const [showCompleted, setShowCompleted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey(view)) === 'true'
    } catch {
      // Private browsing / storage disabled — falls back to session-only
      // state starting from the default (hidden).
      return false
    }
  })

  function toggle() {
    setShowCompleted((prev) => {
      const next = !prev
      try {
        localStorage.setItem(storageKey(view), String(next))
      } catch {
        // ignore — see above
      }
      return next
    })
  }

  return { showCompleted, toggle }
}
