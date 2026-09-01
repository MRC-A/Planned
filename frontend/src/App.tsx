import { useState } from 'react'
import TableView from './views/TableView'
import TodoView from './views/TodoView'
import CalendarView from './views/CalendarView'
import GanttView from './views/GanttView'
import ChatPanel from './views/ChatPanel'

type ViewName = 'table' | 'todo' | 'calendar' | 'gantt'

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'todo', label: 'To-Do' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'gantt', label: 'Gantt' },
]

export default function App() {
  const [view, setView] = useState<ViewName>('table')

  return (
    <div className="flex h-screen bg-background text-foreground">
      <main className="flex flex-1 flex-col">
        <nav className="flex gap-2 border-b border-border px-6 py-3">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                view === v.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {v.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-auto p-6">
          {view === 'table' && <TableView />}
          {view === 'todo' && <TodoView />}
          {view === 'calendar' && <CalendarView />}
          {view === 'gantt' && <GanttView />}
        </div>
      </main>
      <ChatPanel />
    </div>
  )
}
