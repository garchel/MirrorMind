import { describe, expect, it } from 'vitest'
import { diffVaultNotePaths } from './vaultWatcher'

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
