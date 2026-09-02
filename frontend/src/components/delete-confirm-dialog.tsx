// Confirmation gate in front of DELETE /api/tasks/{id} — deleting was
// previously one click with no way back (C9). Controlled like
// TaskDetailDialog, since the "trigger" is a per-row button rather than one
// element to wrap. If the task has children, says so up front: the backend
// promotes them to top-level rather than deleting them (see
// api/tasks.py::delete_task / CLAUDE.md's subtasks section), so this warns
// about that outcome rather than offering a cascade option that doesn't
// exist server-side.
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Task } from '@/types/task'

interface DeleteConfirmDialogProps {
  task: Task | null
  childCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  deleting: boolean
}

export default function DeleteConfirmDialog({
  task,
  childCount,
  open,
  onOpenChange,
  onConfirm,
  deleting,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {task && (
          <>
            <DialogHeader>
              <DialogTitle>Delete "{task.title}"?</DialogTitle>
            </DialogHeader>

            <p className="text-sm text-muted-foreground">
              This can't be undone.
              {childCount > 0 && (
                <>
                  {' '}
                  It has {childCount} subtask{childCount === 1 ? '' : 's'} — {childCount === 1 ? 'it' : 'they'}{' '}
                  will become top-level task{childCount === 1 ? '' : 's'} instead of being deleted too.
                </>
              )}
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
