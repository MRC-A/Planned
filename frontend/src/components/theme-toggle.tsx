// One-button control for the light/dark preference (see hooks/use-theme.ts),
// cycling System → Light → Dark. Presentational only — the state lives in
// App.tsx, the same split as ShowCompletedToggle / useShowCompleted.
//
// Icon-only: the nav bar already carries Export/Import, and the current
// state is legible from the icon itself (screen/sun/moon) with the full
// label on hover and for assistive tech.
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ThemePreference } from '@/hooks/use-theme'

const ICON = { system: Monitor, light: Sun, dark: Moon }

const LABEL: Record<ThemePreference, string> = {
  system: 'Theme: follow system (click for light)',
  light: 'Theme: light (click for dark)',
  dark: 'Theme: dark (click to follow system)',
}

interface ThemeToggleProps {
  theme: ThemePreference
  onCycle: () => void
}

export default function ThemeToggle({ theme, onCycle }: ThemeToggleProps) {
  const Icon = ICON[theme]
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onCycle}
      title={LABEL[theme]}
      aria-label={LABEL[theme]}
      className="text-muted-foreground"
    >
      <Icon />
    </Button>
  )
}
