// Confirmation gate in front of DELETE /api/tasks/{id} and POST
// /api/tasks/bulk-delete — deleting was previously one click with no way
// back (C9). Controlled like TaskDetailDialog, since the "trigger" is a
// per-row button (or the bulk action bar) rather than one element to wrap.
// Handles both a single task and a multi-select bulk delete through the
// same `tasks` array (length 1 for the row-level trash icon). If any of
// the selected tasks has a child that isn't *also* selected, says so up
// front: the backend promotes that child to top-level rather than deleting
// it (see api/tasks.py::_detach_references / CLAUDE.md's subtasks
// section), so this warns about that outcome rather than offering a
// cascade option that doesn't exist server-side.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Task } from '@/types/task'

const TITLE_LIST_LIMIT = 8

interface DeleteConfirmDialogProps {
  tasks: Task[]
  childCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  deleting: boolean
}

export default function DeleteConfirmDialog({
  tasks,
  childCount,
  open,
  onOpenChange,
  onConfirm,
  deleting,
}: DeleteConfirmDialogProps) {
  // Same reasoning as TaskDetailDialog: the caller clears `tasks` the
  // moment the dialog starts closing, which would otherwise blank the
  // content mid closing-animation. Keep showing the last non-empty set.
  const [shown, setShown] = useState<Task[]>(tasks)
  useEffect(() => {
    if (tasks.length > 0) setShown(tasks)
  }, [tasks])

  const isBulk = shown.length > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {shown.length > 0 && (
          <>
            <DialogHeader>
              <DialogTitle>{isBulk ? `Delete ${shown.length} tasks?` : `Delete "${shown[0].title}"?`}</DialogTitle>
            </DialogHeader>

            {isBulk && (
              <ul className="max-h-40 list-disc overflow-y-auto rounded-md border border-border bg-muted/30 px-6 py-2 text-sm text-foreground">
                {shown.slice(0, TITLE_LIST_LIMIT).map((t) => (
                  <li key={t.id} className="truncate">
                    {t.title}
                  </li>
                ))}
                {shown.length > TITLE_LIST_LIMIT && (
                  <li className="text-muted-foreground">+{shown.length - TITLE_LIST_LIMIT} more</li>
                )}
              </ul>
            )}

            <p className="text-sm text-muted-foreground">
              This can't be undone.
              {childCount > 0 && (
                <>
                  {' '}
                  {childCount} subtask{childCount === 1 ? '' : 's'} outside this selection will become top-level
                  task{childCount === 1 ? '' : 's'} instead of being deleted too.
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
