import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { shutdownApp } from '@/lib/api'
import { useChat } from '@/hooks/use-chat'

export default function ChatPanel() {
  const { messages, sending, error, send } = useChat()
  const [draft, setDraft] = useState('')
  const [shuttingDown, setShuttingDown] = useState(false)
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
          <p className="text-sm text-muted-foreground">Ask your local LLM to help plan and organize tasks.</p>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted text-foreground'
              }`}
            >
              {m.content}
            </div>
          ))}
          {sending && (
            <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
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
