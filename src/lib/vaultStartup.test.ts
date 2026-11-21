import { describe, expect, it } from 'vitest'
import {
  decideAccountStartup,
  decideVaultStartup,
  sortKnownVaults,
  vaultNameFromPath,
} from './vaultStartup'

const vault = (path: string, lastOpenedAtMs: number) => ({
  path,
  name: vaultNameFromPath(path),
  lastOpenedAtMs,
})

describe('decideVaultStartup', () => {
  it('sem vault conhecido, pergunta onde ficam as notas', () => {
    expect(decideVaultStartup([])).toEqual({ kind: 'choose' })
  })

  it('com um vault só, abre direto — sem modal e sem tela', () => {
    // A regra existe porque a pergunta era diária e a resposta nunca mudava.
    expect(decideVaultStartup([vault('C:/notas/Estudo', 10)])).toEqual({
      kind: 'open',
      path: 'C:/notas/Estudo',
    })
  })

  it('com dois ou mais, mostra a escolha', () => {
    const lista = [vault('C:/notas/Estudo', 10), vault('C:/notas/Medicina', 5)]
    expect(decideVaultStartup(lista)).toEqual({ kind: 'choose' })
  })
})

describe('sortKnownVaults', () => {
  it('mais recente primeiro e sem caminho repetido', () => {
    const ordenada = sortKnownVaults([
      vault('C:/a', 1),
      vault('C:/b', 9),
      vault('C:/a', 3),
    ])
    expect(ordenada.map((item) => item.path)).toEqual(['C:/b', 'C:/a'])
  })
})

describe('vaultNameFromPath', () => {
  it('usa o último segmento, com barra do Windows ou do Unix', () => {
    expect(vaultNameFromPath('C:\\Users\\paulo\\Estudo')).toBe('Estudo')
    expect(vaultNameFromPath('/home/paulo/estudo/')).toBe('estudo')
  })
})

describe('decideAccountStartup', () => {
  const daMaquina = [vault('C:/notas/Estudo', 10)]

  it('conta com um vínculo abre aquela pasta, mesmo que a máquina conheça outra', () => {
    expect(decideAccountStartup([{ path: 'D:/trabalho' }], daMaquina)).toEqual({
      kind: 'open',
      path: 'D:/trabalho',
    })
  })

  it('conta com dois vínculos mostra a escolha', () => {
    expect(decideAccountStartup([{ path: 'D:/a' }, { path: 'D:/b' }], daMaquina)).toEqual({
      kind: 'choose',
    })
  })

  it('conta nova (sem vínculo) cai na regra da máquina — convidado não perde nada', () => {
    expect(decideAccountStartup([], daMaquina)).toEqual({ kind: 'open', path: 'C:/notas/Estudo' })
    expect(decideAccountStartup([], [])).toEqual({ kind: 'choose' })
  })
})
