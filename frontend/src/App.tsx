import { useState } from 'react'
import TodoView from './views/TodoView'
import CalendarView from './views/CalendarView'
import GanttView from './views/GanttView'
import ChatPanel from './views/ChatPanel'

type ViewName = 'todo' | 'calendar' | 'gantt'

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'todo', label: 'To-Do' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'gantt', label: 'Gantt' },
]

export default function App() {
  const [view, setView] = useState<ViewName>('todo')

  return (
    <div className="flex h-screen bg-neutral-50 text-neutral-900">
      <main className="flex flex-1 flex-col">
        <nav className="flex gap-2 border-b border-neutral-200 px-6 py-3">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === v.id ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-auto p-6">
          {view === 'todo' && <TodoView />}
          {view === 'calendar' && <CalendarView />}
          {view === 'gantt' && <GanttView />}
        </div>
      </main>
      <ChatPanel />
    </div>
  )
}
