// Import is the one place the app bulk-creates from a file it did not write,
// and a real incident (35 stray duplicate rows, see CLAUDE.md) came out of
// it. These cover the parsing half: what a malformed or foreign file is
// allowed to do before any request is sent.
import { describe, expect, it } from 'vitest'
import { parseTasksBackup, toImportDraft } from './backup'

describe('parseTasksBackup', () => {
  it('accepts a well-formed export', () => {
    const rows = parseTasksBackup(JSON.stringify([{ title: 'a' }, { title: 'b' }]))

    expect(rows.map((r) => r.title)).toEqual(['a', 'b'])
  })

  it('rejects JSON that is not an array', () => {
    expect(() => parseTasksBackup('{"title":"a"}')).toThrow(/array/i)
  })

  it('rejects text that is not JSON at all', () => {
    expect(() => parseTasksBackup('not json')).toThrow()
  })

  it('keeps the usable rows and drops the ones with no title', () => {
    // A file from an older or hand-edited version should import what it can
    // rather than failing outright.
    const rows = parseTasksBackup(
      JSON.stringify([{ title: 'keep' }, { description: 'no title' }, { title: 'also keep' }]),
    )

    expect(rows.map((r) => r.title)).toEqual(['keep', 'also keep'])
  })

  it('drops a row whose title is the wrong type', () => {
    expect(parseTasksBackup(JSON.stringify([{ title: 42 }, { title: null }]))).toEqual([])
  })

  it('survives a null entry in the array', () => {
    expect(() => parseTasksBackup(JSON.stringify([null, { title: 'ok' }]))).not.toThrow()
    expect(parseTasksBackup(JSON.stringify([null, { title: 'ok' }]))).toHaveLength(1)
  })

  it('returns an empty list for an empty array', () => {
    expect(parseTasksBackup('[]')).toEqual([])
  })
})

describe('toImportDraft', () => {
  it('always clears parentId and dependsOn', () => {
    // The ids in the file belong to whichever database exported it. They are
    // relinked in a second pass once every row has a real new id; carrying
    // them through here would point at whatever happens to hold that id now.
    const draft = toImportDraft({ title: 't', parentId: 99, dependsOn: 42 })

    expect(draft.parentId).toBeNull()
    expect(draft.dependsOn).toBeNull()
  })

  it('fills sensible defaults for everything the file omitted', () => {
    expect(toImportDraft({ title: 'Only a title' })).toEqual({
      title: 'Only a title',
      description: '',
      status: 'todo',
      priority: 'medium',
      startDate: null,
      dueDate: null,
      durationHours: null,
      dependsOn: null,
      parentId: null,
      tags: [],
    })
  })

  it('preserves the fields the file did provide', () => {
    const draft = toImportDraft({
      title: 't',
      description: 'd',
      status: 'done',
      priority: 'urgent',
      startDate: '2026-09-08',
      dueDate: '2026-09-12',
      durationHours: 3,
      tags: ['x'],
    })

    expect(draft).toMatchObject({
      description: 'd',
      status: 'done',
      priority: 'urgent',
      startDate: '2026-09-08',
      dueDate: '2026-09-12',
      durationHours: 3,
      tags: ['x'],
    })
  })
})
