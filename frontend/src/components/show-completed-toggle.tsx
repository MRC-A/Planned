// Shared control for the per-view "show completed tasks" preference (see
// hooks/use-show-completed.ts) — same look in Table, To-Do, Calendar, and
// Gantt so the affordance is recognizable across views even though each
// view remembers its own choice.
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ShowCompletedToggleProps {
  showCompleted: boolean
  hiddenCount: number
  onToggle: () => void
}

export default function ShowCompletedToggle({ showCompleted, hiddenCount, onToggle }: ShowCompletedToggleProps) {
  return (
    <Button variant="outline" size="sm" onClick={onToggle} className="text-muted-foreground">
      {showCompleted ? <EyeOff /> : <Eye />}
      {showCompleted ? 'Hide completed' : hiddenCount > 0 ? `Show completed (${hiddenCount})` : 'Show completed'}
    </Button>
  )
}
