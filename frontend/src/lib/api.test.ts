// The snake_case <-> camelCase converters are hand-maintained mirrors of
// backend/src/planned/models.py. CLAUDE.md warns that adding or renaming a
// field means touching four places; these tests are what turns forgetting
// one of them into a failure rather than a field that silently reads as
// undefined in every view.
import { describe, expect, it } from 'vitest'
import { fromApi, toApiPayload, type ApiTask } from './api'
import type { Task } from '@/types/task'

const apiTask: ApiTask = {
  id: 7,
  title: 'Write the report',
  description: 'Quarterly summary',
  status: 'in_progress',
  priority: 'high',
  start_date: '2026-09-08T00:00:00',
  due_date: '2026-09-12T00:00:00',
  duration_hours: 6,
  depends_on: 3,
  parent_id: 2,
  tags: 'work, urgent',
  recurrence: 'weekly',
  created_at: '2026-09-01T10:00:00',
  updated_at: '2026-09-02T11:00:00',
}

describe('fromApi', () => {
  it('maps every field the backend sends', () => {
    const task = fromApi(apiTask)

    // Spelled out rather than snapshotted: a snapshot would happily record a
    // field going missing as the new expected value.
    expect(task).toEqual<Task>({
      id: 7,
      title: 'Write the report',
      description: 'Quarterly summary',
      status: 'in_progress',
      priority: 'high',
      startDate: '2026-09-08T00:00:00',
      dueDate: '2026-09-12T00:00:00',
      durationHours: 6,
      dependsOn: 3,
      parentId: 2,
      tags: ['work', 'urgent'],
      recurrence: 'weekly',
      createdAt: '2026-09-01T10:00:00',
      updatedAt: '2026-09-02T11:00:00',
    })
  })

  it('splits the comma-separated tag column and trims each tag', () => {
    expect(fromApi({ ...apiTask, tags: 'a,  b ,c' }).tags).toEqual(['a', 'b', 'c'])
  })

  it('turns a null or empty tag column into an empty array, never null', () => {
    // Every view calls tags.map or tags.join — a null here throws on render.
    expect(fromApi({ ...apiTask, tags: null }).tags).toEqual([])
    expect(fromApi({ ...apiTask, tags: '' }).tags).toEqual([])
  })

  it('drops empty segments from a trailing or doubled comma', () => {
    expect(fromApi({ ...apiTask, tags: 'a,,b,' }).tags).toEqual(['a', 'b'])
  })

  it('keeps nulls as nulls rather than coercing them', () => {
    const task = fromApi({
      ...apiTask,
      start_date: null,
      due_date: null,
      duration_hours: null,
      depends_on: null,
      parent_id: null,
    })

    expect(task.startDate).toBeNull()
    expect(task.dueDate).toBeNull()
    expect(task.durationHours).toBeNull()
    expect(task.dependsOn).toBeNull()
    expect(task.parentId).toBeNull()
  })
})

describe('toApiPayload', () => {
  it('omits keys that were not provided, so a PATCH stays partial', () => {
    // The distinction this protects: absent means "leave it alone", while an
    // explicit null means "clear it". Sending every field on every PATCH
    // would silently wipe whatever the caller did not mention.
    expect(toApiPayload({ title: 'New title' })).toEqual({ title: 'New title' })
  })

  it('sends an explicit null through as a real clear instruction', () => {
    expect(toApiPayload({ dueDate: null })).toEqual({ due_date: null })
  })

  it('converts every camelCase key to the backend spelling', () => {
    const payload = toApiPayload({
      title: 't',
      description: 'd',
      status: 'done',
      priority: 'low',
      startDate: '2026-09-08',
      dueDate: '2026-09-12',
      durationHours: 4,
      dependsOn: 1,
      parentId: 2,
      tags: ['a', 'b'],
    })

    expect(payload).toEqual({
      title: 't',
      description: 'd',
      status: 'done',
      priority: 'low',
      start_date: '2026-09-08',
      due_date: '2026-09-12',
      duration_hours: 4,
      depends_on: 1,
      parent_id: 2,
      tags: 'a, b',
    })
  })

  it('joins tags back into the comma-separated column', () => {
    expect(toApiPayload({ tags: [] })).toEqual({ tags: '' })
  })

  it('round-trips a task through both converters unchanged', () => {
    const task = fromApi(apiTask)
    const back = fromApi({ ...apiTask, ...toApiPayload(task) } as ApiTask)

    expect(back).toEqual(task)
  })
})
