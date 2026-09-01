// Keeps the conversation in memory (not persisted — it resets on reload)
// and sends the full history with each message, since the backend is
// stateless between requests.
import { useState } from 'react'
import { sendChatMessage, type ChatMessage } from '@/lib/api'

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    const next: ChatMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(next)
    setSending(true)
    setError(null)
    try {
      const reply = await sendChatMessage(next)
      setMessages([...next, reply])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  return { messages, sending, error, send }
}
