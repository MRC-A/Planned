// Keeps the conversation in memory (not persisted — it resets on reload)
// and sends the full history with each message, since the backend is
// stateless between requests.
import { useRef, useState } from 'react'
import { sendChatMessage, type ChatMessage } from '@/lib/api'

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Lets the user abandon a reply that's taking too long. The backend caps
  // the model at LLM_TIMEOUT_SECONDS, but that's still a long wait to be
  // stuck watching with no way out.
  const abortRef = useRef<AbortController | null>(null)

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setSending(true)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const reply = await sendChatMessage(next, controller.signal)
      setMessages([...next, reply])
    } catch (err) {
      // Cancelling is a deliberate action, not a failure — don't show it as
      // an error. The user's own message stays in the history so they can
      // send it again without retyping.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    } finally {
      abortRef.current = null
      setSending(false)
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  return { messages, sending, error, send, cancel }
}
