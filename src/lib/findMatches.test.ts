import { describe, expect, it } from 'vitest'
import { findTextMatches } from './findMatches'

describe('findTextMatches', () => {
  it('acha ocorrencias com offsets (case-insensitive)', () => {
    expect(findTextMatches('Aula sobre a aula', 'aula')).toEqual([
      { from: 0, to: 4 },
      { from: 13, to: 17 },
    ])
  })

  it('query vazia ou so espacos nao casa nada', () => {
    expect(findTextMatches('texto', '')).toEqual([])
    expect(findTextMatches('texto', '   ')).toEqual([])
  })

  it('escapa regex da query (texto literal)', () => {
    expect(findTextMatches('a.b aab', 'a.b')).toEqual([{ from: 0, to: 3 }])
    expect(findTextMatches('(x)', '(x)')).toEqual([{ from: 0, to: 3 }])
  })

  it('casa multilinha atravessando quebras', () => {
    expect(findTextMatches('um\ndois', 'm\nd')).toEqual([{ from: 1, to: 4 }])
  })
})
