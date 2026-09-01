import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { shutdownApp } from '@/lib/api'

export default function ChatPanel() {
  const [shuttingDown, setShuttingDown] = useState(false)

  async function handleQuit() {
    const confirmed = window.confirm(
      'Stop the Planned servers? You will need to relaunch the app to use it again.',
    )
    if (!confirmed) return
    setShuttingDown(true)
    await shutdownApp()
  }

  if (shuttingDown) {
    return (
      <aside className="flex w-80 shrink-0 items-center justify-center border-l border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Shutting down — you can close this tab.</p>
      </aside>
    )
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">Assistant</h2>
      <p className="mt-2 text-sm text-muted-foreground">Chat with your local LLM — coming soon</p>
      <div className="mt-auto pt-4">
        <Button variant="destructive" size="sm" className="w-full" onClick={handleQuit}>
          Quit app
        </Button>
      </div>
    </aside>
  )
}
