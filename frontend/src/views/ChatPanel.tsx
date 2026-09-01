import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { shutdownApp } from '@/lib/api'
import { useChat } from '@/hooks/use-chat'
import { PRIORITY_BADGE_VARIANT, PRIORITY_LABEL, formatDate } from '@/lib/task-display'
import type { ProposedTask, Task, TaskDraft } from '@/types/task'

interface ChatPanelProps {
  onCreateTask: (draft: TaskDraft) => Promise<Task>
}

function toDraft(t: ProposedTask, parentId: number | null): TaskDraft {
  return {
    title: t.title,
    description: t.description,
    priority: t.priority,
    startDate: t.startDate,
    dueDate: t.dueDate,
    durationHours: t.durationHours,
    tags: t.tags,
    parentId,
  }
}

export default function ChatPanel({ onCreateTask }: ChatPanelProps) {
  const { messages, sending, error, send } = useChat()
  const [draft, setDraft] = useState('')
  const [shuttingDown, setShuttingDown] = useState(false)
  const [resolvedProposals, setResolvedProposals] = useState<Set<number>>(new Set())
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null)
  const [proposalError, setProposalError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  async function handleQuit() {
    const confirmed = window.confirm(
      'Stop the Planned servers? You will need to relaunch the app to use it again.',
    )
    if (!confirmed) return
    setShuttingDown(true)
    await shutdownApp()
  }

  function submitDraft() {
    if (!draft.trim() || sending) return
    send(draft)
    setDraft('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submitDraft()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitDraft()
    }
  }

  async function handleCreateProposed(index: number, tasks: ProposedTask[]) {
    setApplyingIndex(index)
    setProposalError(null)
    try {
      // Two passes: top-level tasks first, so their real (database) ids
      // are known before creating any subtask that references them —
      // parentRef is just an index into this proposal batch, not a real id.
      const realIdByRef = new Map<number, number>()
      for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].parentRef !== null) continue
        const created = await onCreateTask(toDraft(tasks[i], null))
        realIdByRef.set(i, created.id)
      }
      for (let i = 0; i < tasks.length; i++) {
        const ref = tasks[i].parentRef
        if (ref === null) continue
        const parentId = realIdByRef.get(ref) ?? null
        await onCreateTask(toDraft(tasks[i], parentId))
      }
      setResolvedProposals((prev) => new Set(prev).add(index))
    } catch (err) {
      setProposalError(err instanceof Error ? err.message : 'Failed to create tasks')
    } finally {
      setApplyingIndex(null)
    }
  }

  function handleDiscardProposed(index: number) {
    setResolvedProposals((prev) => new Set(prev).add(index))
  }

  if (shuttingDown) {
    return (
      <aside className="flex w-80 shrink-0 items-center justify-center border-l border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Shutting down — you can close this tab.</p>
      </aside>
    )
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Assistant</h2>
        <Button variant="ghost" size="sm" onClick={handleQuit} className="text-muted-foreground">
          Quit
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Tell your assistant what you need to get done — it can turn that into tasks for you to
            review and add.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                }`}
              >
                {m.content}
              </div>

              {m.proposedTasks && m.proposedTasks.length > 0 && (
                <div className="rounded-lg border border-border bg-background p-3">
                  <ul className="flex flex-col gap-2">
                    {m.proposedTasks.map((t, ti) => (
                      <li
                        key={ti}
                        className={`flex flex-col gap-0.5 ${t.parentRef !== null ? 'pl-4 text-[11px]' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-medium text-foreground ${t.parentRef !== null ? '' : 'text-xs'}`}>
                            {t.title}
                          </span>
                          <Badge variant={PRIORITY_BADGE_VARIANT[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>
                        </div>
                        {(t.startDate || t.dueDate) && (
                          <span className="text-[11px] text-muted-foreground">
                            {formatDate(t.startDate)} → {formatDate(t.dueDate)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>

                  {resolvedProposals.has(i) ? (
                    <p className="mt-2 text-xs text-muted-foreground">Done.</p>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={applyingIndex === i}
                        onClick={() => handleCreateProposed(i, m.proposedTasks!)}
                      >
                        {applyingIndex === i
                          ? 'Creating…'
                          : `Create ${m.proposedTasks.length} task${m.proposedTasks.length === 1 ? '' : 's'}`}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={applyingIndex === i}
                        onClick={() => handleDiscardProposed(i)}
                      >
                        Discard
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          )}
        </div>
      </div>

      {(error || proposalError) && (
        <p className="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error || proposalError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message your assistant…"
          rows={2}
          className="resize-none"
        />
        <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
          Send
        </Button>
      </form>
    </aside>
  )
}
