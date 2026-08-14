import { describe, expect, it } from 'vitest'
import { canApplyInventoryIncrementally, diffVaultNotePaths } from './vaultWatcher'

describe('diffVaultNotePaths', () => {
  it('detects a single external rename', () => {
    const diff = diffVaultNotePaths(['aula.md'], ['resumo.md'])
    expect(diff).toEqual({ removedPaths: ['aula.md'], createdPaths: ['resumo.md'] })
  })

  it('detects an external move between folders', () => {
    const diff = diffVaultNotePaths(
      ['materias/aula.md', 'manter.md'],
      ['Arquivo/aula.md', 'manter.md'],
    )
    expect(diff).toEqual({
      removedPaths: ['materias/aula.md'],
      createdPaths: ['Arquivo/aula.md'],
    })
  })

  it('returns empty diffs when nothing changed', () => {
    const diff = diffVaultNotePaths(['a.md', 'b.md'], ['a.md', 'b.md'])
    expect(diff).toEqual({ removedPaths: [], createdPaths: [] })
  })

  it('reports pure creations and deletions separately', () => {
    const diff = diffVaultNotePaths(['removida.md'], ['nova.md'])
    expect(diff).toEqual({ removedPaths: ['removida.md'], createdPaths: ['nova.md'] })
  })

  it('handles multiple simultaneous changes', () => {
    const diff = diffVaultNotePaths(
      ['a.md', 'b.md', 'c.md'],
      ['a.md', 'x.md', 'y.md'],
    )
    expect(diff).toEqual({ removedPaths: ['b.md', 'c.md'], createdPaths: ['x.md', 'y.md'] })
  })
})

describe('canApplyInventoryIncrementally', () => {
  it('applies single attachment create/remove/rename without a full rescan', () => {
    expect(canApplyInventoryIncrementally({ kind: 'create', paths: ['media/foto.png'] })).toBe(true)
    expect(canApplyInventoryIncrementally({ kind: 'remove', paths: ['media/foto.PNG'] })).toBe(true)
    expect(canApplyInventoryIncrementally({ kind: 'rename', paths: ['media/a.png', 'media/b.png'] })).toBe(true)
  })

  it('applies folder create/remove', () => {
    expect(canApplyInventoryIncrementally({ kind: 'create', paths: ['novas'] })).toBe(true)
    expect(canApplyInventoryIncrementally({ kind: 'remove', paths: ['velhas'] })).toBe(true)
  })

  it('rejects note, special-file, rescan and modify changes', () => {
    expect(canApplyInventoryIncrementally({ kind: 'create', paths: ['nota.md'] })).toBe(false)
    expect(canApplyInventoryIncrementally({ kind: 'rename', paths: ['a.md', 'b.md'] })).toBe(false)
    expect(canApplyInventoryIncrementally({ kind: 'create', paths: ['diagrama.canvas'] })).toBe(false)
    expect(canApplyInventoryIncrementally({ kind: 'create', paths: ['rascunho.excalidraw'] })).toBe(false)
    expect(canApplyInventoryIncrementally({ kind: 'modify', paths: ['media/foto.png'] })).toBe(false)
    expect(canApplyInventoryIncrementally({ kind: 'rescan', paths: [] })).toBe(false)
    expect(canApplyInventoryIncrementally()).toBe(false)
  })

  it('rejects batches with more than two paths', () => {
    expect(canApplyInventoryIncrementally({ kind: 'create', paths: ['a.png', 'b.png', 'c.png'] })).toBe(false)
  })
})
