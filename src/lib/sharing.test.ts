import { describe, expect, it } from 'vitest'
import { othersWhoUsed } from './sharing'

describe('othersWhoUsed', () => {
  it('tira o meu nome da lista, ignorando caixa e espaço', () => {
    expect(othersWhoUsed(['Paulo', 'Ana'], '  paulo ')).toEqual(['Ana'])
  })

  it('sem identidade conhecida, todo nome conta como outra pessoa', () => {
    // Primeiro uso / convidado: a pasta já foi aberta por alguém, e é isso que o
    // aviso precisa dizer.
    expect(othersWhoUsed(['Paulo'], null)).toEqual(['Paulo'])
  })

  it('não repete nome e descarta vazio', () => {
    expect(othersWhoUsed(['Ana', ' ana ', '', 'Joao'], null)).toEqual(['Ana', 'Joao'])
  })

  it('pasta usada só por mim não gera aviso', () => {
    expect(othersWhoUsed(['Paulo'], 'Paulo')).toEqual([])
  })
})
