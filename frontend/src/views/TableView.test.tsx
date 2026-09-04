// Regression test for the self-contradicting filter (see CLAUDE.md's Table
// search & filters note).
//
// Only top-level rows are ever mapped — children render underneath one — so
// the first version of filtering made a matching *subtask* invisible while
// still counting it. The view showed "1 task" in the counter and "No tasks
// match your search/filters" in the table at the same time, for a real
// match. The fix keeps a non-matching parent as a carrier row.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TableView from './TableView'
import type { Task } from '@/types/task'

function task(fields: Partial<Task> & { id: number; title: string }): Task {
  return {
    description: '',
    status: 'todo',
    priority: 'medium',
    startDate: null,
    dueDate: null,
    durationHours: null,
    dependsOn: null,
    parentId: null,
    tags: [],
    recurrence: null,
    createdAt: '2026-09-01T00:00:00',
    updatedAt: '2026-09-01T00:00:00',
    ...fields,
  }
}

function renderTable(tasks: Task[]) {
  return render(
    <TableView
      tasks={tasks}
      loading={false}
      error={null}
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      onCycleStatus={vi.fn()}
      onBulkDelete={vi.fn()}
    />,
  )
}

const PARENT = task({ id: 1, title: 'Infrastructure work' })
const CHILD = task({ id: 2, title: 'Configure the firewall', parentId: 1 })
const UNRELATED = task({ id: 3, title: 'Write the report' })

describe('search', () => {
  it('shows a matching subtask even though its parent does not match', async () => {
    renderTable([PARENT, CHILD, UNRELATED])

    await userEvent.type(screen.getByPlaceholderText(/search title or description/i), 'firewall')

    expect(screen.getByText('Configure the firewall')).toBeInTheDocument()
    // The parent stays on screen purely to carry the match.
    expect(screen.getByText('Infrastructure work')).toBeInTheDocument()
    expect(screen.queryByText('Write the report')).not.toBeInTheDocument()
  })

  it('never shows "no match" while a match is on screen', async () => {
    // The exact contradiction the bug produced.
    renderTable([PARENT, CHILD, UNRELATED])

    await userEvent.type(screen.getByPlaceholderText(/search title or description/i), 'firewall')

    expect(screen.queryByText(/no tasks match/i)).not.toBeInTheDocument()
  })

  it('auto-reveals the matching child without needing the chevron', async () => {
    // Collapsed by default: leaving the match behind a chevron is the same
    // failure from the user's point of view.
    renderTable([PARENT, CHILD, UNRELATED])
    expect(screen.queryByText('Configure the firewall')).not.toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText(/search title or description/i), 'firewall')

    expect(screen.getByText('Configure the firewall')).toBeInTheDocument()
  })

  it('promotes a matching subtask when its parent is filtered out entirely', async () => {
    // A done parent is hidden by default, so nothing is left to carry the
    // child — it has to stand on its own row.
    const doneParent = task({ id: 1, title: 'Infrastructure work', status: 'done' })
    renderTable([doneParent, CHILD])

    await userEvent.type(screen.getByPlaceholderText(/search title or description/i), 'firewall')

    expect(screen.getByText('Configure the firewall')).toBeInTheDocument()
    expect(screen.queryByText('Infrastructure work')).not.toBeInTheDocument()
  })

  it('matches on the description, not just the title', async () => {
    renderTable([task({ id: 9, title: 'Opaque title', description: 'mentions kubernetes' })])

    await userEvent.type(screen.getByPlaceholderText(/search title or description/i), 'kubernetes')

    expect(screen.getByText('Opaque title')).toBeInTheDocument()
  })

  it('is case-insensitive', async () => {
    renderTable([UNRELATED])

    await userEvent.type(screen.getByPlaceholderText(/search title or description/i), 'REPORT')

    expect(screen.getByText('Write the report')).toBeInTheDocument()
  })

  it('says so plainly when genuinely nothing matches', async () => {
    renderTable([PARENT, CHILD, UNRELATED])

    await userEvent.type(screen.getByPlaceholderText(/search title or description/i), 'zzzznothing')

    expect(screen.getByText(/no tasks match/i)).toBeInTheDocument()
  })

  it('restores the full list when the search is cleared', async () => {
    renderTable([PARENT, CHILD, UNRELATED])
    const input = screen.getByPlaceholderText(/search title or description/i)

    await userEvent.type(input, 'firewall')
    await userEvent.clear(input)

    expect(screen.getByText('Write the report')).toBeInTheDocument()
    // Back to collapsed: the child hides again behind its parent's chevron.
    expect(screen.queryByText('Configure the firewall')).not.toBeInTheDocument()
  })
})

describe('completed tasks', () => {
  it('hides done tasks by default and explains why the view is empty', () => {
    renderTable([task({ id: 5, title: 'Finished thing', status: 'done' })])

    expect(screen.queryByText('Finished thing')).not.toBeInTheDocument()
    // An unexplained empty table reads as broken rather than filtered, so the
    // message has to say *why* — matched specifically, since a loose
    // /completed/i also hits the "Show completed" button.
    expect(screen.getByText(/every task is completed/i)).toBeInTheDocument()
  })

  it('reveals them once the toggle is used', async () => {
    renderTable([task({ id: 5, title: 'Finished thing', status: 'done' })])

    await userEvent.click(screen.getByRole('button', { name: /show completed/i }))

    expect(screen.getByText('Finished thing')).toBeInTheDocument()
  })
})
