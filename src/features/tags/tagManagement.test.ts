import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  applyTagManagementChange,
  previewTagManagementChange,
} from './tagManagement'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const rule = {
  tag: 'prova',
  autoEnroll: true,
  firstReviewIntervalDays: 1,
  targetRetention: 0.9,
  priorityWeight: 3,
  minIntervalDays: 1,
  maxIntervalDays: 90,
  deadlineAtUnixMs: null,
}

const config = {
  revision: 2,
  defaults: {
    firstReviewIntervalDays: 2,
    targetRetention: 0.8,
    priorityWeight: 1,
    minIntervalDays: 1,
    maxIntervalDays: 365,
  },
  tagRules: [rule],
  segmentation: { maxWholeNoteWords: 800 },
  updatedAtUnixMs: null,
  affectedNoteCount: 2,
}

describe('tag management contract', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  it('sends the normalized preview contract', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      affectedNotePaths: ['a.md'],
      markdownNotePaths: ['a.md'],
    })

    await expect(previewTagManagementChange('C:\\Vault', {
      currentTag: 'antiga',
      nextTag: 'nova',
      removeFromNotes: false,
    })).resolves.toEqual({
      affectedNotePaths: ['a.md'],
      markdownNotePaths: ['a.md'],
    })
    expect(invoke).toHaveBeenCalledWith('preview_tag_management_change', {
      path: 'C:\\Vault',
      change: {
        currentTag: 'antiga',
        nextTag: 'nova',
        removeFromNotes: false,
      },
    })
  })

  it('applies only the note set that the user confirmed', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      config,
      affectedNotePaths: ['a.md', 'b.md'],
      markdownNotePaths: [],
    })

    await expect(applyTagManagementChange({
      vaultPath: 'C:\\Vault',
      expectedRevision: 1,
      tagRules: [rule],
      change: {
        currentTag: 'prova',
        nextTag: 'prova',
        removeFromNotes: false,
      },
      expectedAffectedNotePaths: ['a.md', 'b.md'],
    })).resolves.toEqual({
      config,
      affectedNotePaths: ['a.md', 'b.md'],
      markdownNotePaths: [],
    })
    expect(invoke).toHaveBeenCalledWith('apply_tag_management_change', expect.objectContaining({
      expectedRevision: 1,
      expectedAffectedNotePaths: ['a.md', 'b.md'],
    }))
  })

  it('rejects malformed backend results', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      config,
      affectedNotePaths: 'a.md',
      markdownNotePaths: [],
    })
    await expect(applyTagManagementChange({
      vaultPath: 'C:\\Vault',
      expectedRevision: 1,
      tagRules: [rule],
      change: {
        currentTag: 'prova',
        nextTag: null,
        removeFromNotes: false,
      },
      expectedAffectedNotePaths: ['a.md'],
    })).rejects.toThrow()
  })
})
