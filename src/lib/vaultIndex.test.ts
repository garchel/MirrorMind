import { describe, expect, it } from 'vitest'
import { createVaultIndex } from './vaultIndex'

const DOCS = [
  { relativePath: 'notas/a.md', content: 'Veja [[b]] e [[notas/c]].' },
  { relativePath: 'notas/b.md', content: 'Sem links.' },
  { relativePath: 'notas/c.md', content: 'Volta para [[a]].' },
]

describe('vaultIndex', () => {
  it('rebuild popula indice + cache, e queries respondem', () => {
    const index = createVaultIndex()
    index.rebuild('/vault', DOCS)

    expect(index.getVaultPath()).toBe('/vault')
    expect(index.backlinks('notas/b.md')).toEqual(['notas/a.md'])
    expect(index.targets('notas/a.md').sort()).toEqual(['notas/b.md', 'notas/c.md'])
    expect(index.getDocuments()?.size).toBe(3)
  })

  it('removePaths tira do indice, invalida conteudos e lista origens afetadas', () => {
    const index = createVaultIndex()
    index.rebuild('/vault', DOCS)

    const removal = index.removePaths((path) => path === 'notas/c.md')

    expect(removal.removed).toEqual(['notas/c.md'])
    // a.md apontava para c.md: precisa de re-sync.
    expect(removal.affectedSources).toEqual(['notas/a.md'])
    expect(index.targets('notas/a.md')).toEqual(['notas/b.md'])
    // Fiel ao App: a entrada some, mas a.md ainda cita [[notas/c]] ate o
    // re-sync da origem (via affectedSources) — aresta dangling temporaria.
    expect(index.backlinks('notas/c.md')).toEqual(['notas/a.md'])
    expect(index.getDocuments()).toBeNull()
  })

  it('remapPaths move a entrada preservando conteudo e alvos', () => {
    const index = createVaultIndex()
    index.rebuild('/vault', DOCS)

    index.remapPaths((path) => (path === 'notas/b.md' ? 'notas/renomeada.md' : path))

    // Fiel ao App: a entrada muda de caminho com o mesmo conteudo, mas as
    // origens NAO sao re-resolvidas aqui. O dangling aparece em backlinks
    // (sem filtro); targets so lista notas existentes.
    expect(index.targets('notas/a.md').sort()).toEqual(['notas/c.md'])
    expect(index.backlinks('notas/b.md')).toEqual(['notas/a.md'])
    expect(index.backlinks('notas/renomeada.md')).toEqual([])
    expect(index.getDocuments()).toBeNull()
  })

  it('applyEdit recalcula so a nota salva', () => {
    const index = createVaultIndex()
    index.rebuild('/vault', DOCS)

    index.applyEdit('notas/b.md', 'Agora aponta para [[a]].')

    expect(index.targets('notas/b.md')).toEqual(['notas/a.md'])
    expect(index.backlinks('notas/a.md').sort()).toEqual(['notas/b.md', 'notas/c.md'])
  })

  it('clear e estado inicial respondem vazio sem quebrar', () => {
    const index = createVaultIndex()
    expect(index.backlinks('x.md')).toEqual([])
    expect(index.getSnapshot()).toBeNull()

    index.rebuild('/vault', DOCS)
    index.clear()
    expect(index.getSnapshot()).toBeNull()
    expect(index.getDocuments()).toBeNull()
    expect(index.getVaultPath()).toBeNull()
  })
})
