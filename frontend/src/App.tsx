import { useState } from 'react'
import TableView, { NEXT_STATUS } from './views/TableView'
import TodoView from './views/TodoView'
import CalendarView from './views/CalendarView'
import GanttView from './views/GanttView'
import ChatPanel from './views/ChatPanel'
import BackupControls from './components/backup-controls'
import { useTasks } from './hooks/use-tasks'
import type { Task } from './types/task'

type ViewName = 'table' | 'todo' | 'calendar' | 'gantt'

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'todo', label: 'To-Do' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'gantt', label: 'Gantt' },
]

export default function App() {
  const [view, setView] = useState<ViewName>('table')
  const { tasks, loading, error, add, edit, bulkRemove, refresh } = useTasks()

  function cycleStatus(task: Task) {
    edit(task.id, { status: NEXT_STATUS[task.status] })
  }

  function toggleDone(task: Task) {
    edit(task.id, { status: task.status === 'done' ? 'todo' : 'done' })
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <main className="flex flex-1 flex-col">
        <nav className="flex items-center justify-between gap-2 border-b border-border px-6 py-3">
          <div className="flex gap-2">
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
          </div>
          <BackupControls tasks={tasks} onImported={refresh} />
        </nav>
        <div className="flex-1 overflow-auto p-6">
          {view === 'table' && (
            <TableView
              tasks={tasks}
              loading={loading}
              error={error}
              onCreate={add}
              onEdit={edit}
              onCycleStatus={cycleStatus}
              onBulkDelete={bulkRemove}
            />
          )}
          {view === 'todo' && <TodoView tasks={tasks} loading={loading} onToggleDone={toggleDone} />}
          {view === 'calendar' && <CalendarView tasks={tasks} />}
          {view === 'gantt' && <GanttView tasks={tasks} />}
        </div>
      </main>
      <ChatPanel onCreateTask={add} />
    </div>
  )
}
