import { describe, expect, it } from 'vitest'
import fixtureSource from '../../tests/fixtures/ipc-contract-v1.json?raw'
import {
  parseHistoryStatus,
  parseNoteDocument,
  parseNoteList,
  parseRecentVaultPreference,
  parseSpecialVaultInventory,
  parseVaultSummary,
} from './vault'
import {
  MAX_WATCHER_EVENT_PATHS,
  MAX_WATCHER_PATH_LENGTH,
  parseScopedVaultFileSystemChange,
} from './vaultWatcher'

const fixture = JSON.parse(fixtureSource)

describe('IPC contract serialized by Rust', () => {
  it('accepts the current critical payloads', () => {
    expect(fixture.version).toBe(1)
    expect(parseVaultSummary(fixture.current.vaultSummary).name).toBe('Estudos')
    const partialPreferences = parseVaultSummary(
      fixture.current.partiallyNullableVaultSummary,
    ).obsidianPreferences
    expect(partialPreferences).toEqual({
      newFileLocation: null,
      newFileFolderPath: null,
      attachmentFolderPath: null,
      newLinkFormat: null,
      useMarkdownLinks: null,
      alwaysUpdateLinks: null,
      showUnsupportedFiles: null,
      promptDelete: null,
      trashOption: null,
      userIgnoreFilters: [],
    })
    expect(parseVaultSummary(fixture.current.nullableVaultSummary).obsidianPreferences).toBeNull()
    expect(parseNoteDocument(fixture.current.noteDocument).relativePath).toBe('notas/aula.md')
    expect(parseNoteList(fixture.current.noteList)).toHaveLength(2)
    expect(parseSpecialVaultInventory(fixture.current.specialVaultInventory).files).toHaveLength(1)
    expect(parseRecentVaultPreference(fixture.current.recentVaultPreference).lastVaultPath).toBe('C:\\Vaults\\Estudos')
    expect(parseRecentVaultPreference(fixture.current.nullableRecentVaultPreference).lastVaultPath).toBeNull()
    expect(parseHistoryStatus(fixture.current.historyStatus)).toEqual({ canUndo: true, canRedo: false })
    expect(fixture.current.watcherEvents.map(parseScopedVaultFileSystemChange)).toMatchObject([
      { kind: 'create', paths: ['notas/nova.md'] },
      { kind: 'modify', paths: ['notas/aula.md'] },
      { kind: 'remove', paths: ['notas/antiga.md'] },
      { kind: 'rename', paths: ['notas/origem.md', 'notas/destino.md'] },
      { kind: 'rescan', paths: [] },
    ])
  })

  it('normalizes the supported legacy vault payload', () => {
    expect(
      parseVaultSummary(fixture.legacy.vaultSummaryWithoutObsidianPreferences)
        .obsidianPreferences,
    ).toBeNull()
  })

  it('keeps frontend limits aligned with backend constants', () => {
    const maxPreference = 'x'.repeat(fixture.limits.obsidianPreferenceUtf16Units)
    const baseSummary = fixture.current.vaultSummary
    const preferences = baseSummary.obsidianPreferences

    expect(() => parseVaultSummary({
      ...baseSummary,
      obsidianPreferences: { ...preferences, newFileLocation: maxPreference },
    })).not.toThrow()
    expect(() => parseVaultSummary({
      ...baseSummary,
      obsidianPreferences: { ...preferences, newFileLocation: `${maxPreference}x` },
    })).toThrow()

    const filters = Array.from(
      { length: fixture.limits.obsidianIgnoreFilters },
      (_, index) => `folder-${index}`,
    )
    expect(() => parseVaultSummary({
      ...baseSummary,
      obsidianPreferences: { ...preferences, userIgnoreFilters: filters },
    })).not.toThrow()
    expect(() => parseVaultSummary({
      ...baseSummary,
      obsidianPreferences: { ...preferences, userIgnoreFilters: [...filters, 'overflow'] },
    })).toThrow()

    const files = Array.from(
      { length: fixture.limits.specialVaultFiles },
      (_, index) => ({ name: `file-${index}.bin`, relativePath: `files/file-${index}.bin`, kind: 'unknown' }),
    )
    expect(() => parseSpecialVaultInventory({ files, truncated: true })).not.toThrow()
    expect(() => parseSpecialVaultInventory({
      files: [...files, { name: 'overflow.bin', relativePath: 'overflow.bin', kind: 'unknown' }],
      truncated: true,
    })).toThrow()
  })

  it('rejects malformed watcher events at the interface boundary', () => {
    const modifyEvent = fixture.current.watcherEvents[1]
    expect(() => parseScopedVaultFileSystemChange({ ...modifyEvent, kind: 'execute' })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({ ...modifyEvent, requestId: -1 })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({ ...modifyEvent, requestId: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({ ...modifyEvent, paths: [] })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({
      ...fixture.current.watcherEvents[3],
      paths: ['only-source.md'],
    })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({
      ...fixture.current.watcherEvents[4],
      paths: ['unexpected.md'],
    })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({ ...modifyEvent, paths: ['../outside.md'] })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({ ...modifyEvent, paths: ['C:\\outside.md'] })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({
      ...modifyEvent,
      paths: Array.from({ length: MAX_WATCHER_EVENT_PATHS + 1 }, (_, index) => `note-${index}.md`),
    })).toThrow()
    expect(() => parseScopedVaultFileSystemChange({
      ...modifyEvent,
      paths: [`${'x'.repeat(MAX_WATCHER_PATH_LENGTH)}x`],
    })).toThrow()
  })
})
