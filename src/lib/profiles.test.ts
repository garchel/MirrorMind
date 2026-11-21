import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProfileClient,
  decideProfileOnOpen,
  needsProfileChoice,
  readLastProfileId,
  writeLastProfileId,
  type ProfileSummary,
} from './profiles'

function perfil(overrides: Partial<ProfileSummary> = {}): ProfileSummary {
  return { id: 'padrao', name: 'Eu', color: 'sage', isDefault: true, hasPin: false, ...overrides }
}

describe('cliente de perfis', () => {
  it('fala com os comandos certos e manda os argumentos em camelCase', async () => {
    const invoke = vi.fn(async () => [perfil()])
    const client = createProfileClient(invoke as never)
    const vault = 'C:/notas/vault'

    await client.list(vault)
    expect(invoke).toHaveBeenCalledWith('profiles_list', { vaultRoot: vault })

    await client.create(vault, { name: 'Maria', color: 'sage', pin: '2468' })
    expect(invoke).toHaveBeenCalledWith('profiles_create', {
      vaultRoot: vault,
      name: 'Maria',
      color: 'sage',
      pin: '2468',
    })

    await client.create(vault, { name: 'Ana', color: 'brick' })
    expect(invoke).toHaveBeenCalledWith('profiles_create', {
      vaultRoot: vault,
      name: 'Ana',
      color: 'brick',
      pin: null,
    })

    await client.rename(vault, 'ana', { name: 'Ana Paula', color: 'sage' })
    expect(invoke).toHaveBeenCalledWith('profiles_rename', {
      vaultRoot: vault,
      id: 'ana',
      name: 'Ana Paula',
      color: 'sage',
    })

    await client.remove(vault, 'ana')
    expect(invoke).toHaveBeenCalledWith('profiles_delete', { vaultRoot: vault, id: 'ana' })

    await client.setPin(vault, 'ana', null)
    expect(invoke).toHaveBeenCalledWith('profiles_set_pin', { vaultRoot: vault, id: 'ana', pin: null })

    await client.verifyPin(vault, 'ana', '2468')
    expect(invoke).toHaveBeenCalledWith('profiles_verify_pin', {
      vaultRoot: vault,
      id: 'ana',
      pin: '2468',
    })

    await client.select(vault, 'ana')
    expect(invoke).toHaveBeenCalledWith('profiles_select', {
      vaultRoot: vault,
      id: 'ana',
      force: false,
    })

    await client.select(vault, 'ana', { force: true })
    expect(invoke).toHaveBeenLastCalledWith('profiles_select', {
      vaultRoot: vault,
      id: 'ana',
      force: true,
    })
  })
})

describe('quando a tela de perfil aparece', () => {
  it('sozinho e sem PIN entra direto', () => {
    expect(needsProfileChoice([perfil()])).toBe(false)
  })

  it('com PIN pergunta sempre — senão o PIN não protege nada', () => {
    expect(needsProfileChoice([perfil({ hasPin: true })])).toBe(true)
  })

  it('com mais de um perfil pergunta sempre', () => {
    expect(needsProfileChoice([perfil(), perfil({ id: 'maria', name: 'Maria', isDefault: false })])).toBe(true)
  })

  it('sem perfil nenhum não trava a abertura', () => {
    expect(needsProfileChoice([])).toBe(false)
  })
})

describe('memória do último perfil por vault', () => {
  beforeEach(() => localStorage.clear())

  it('guarda por vault e devolve nulo quando não conhece', () => {
    expect(readLastProfileId('C:/a')).toBeNull()
    writeLastProfileId('C:/a', 'maria')
    writeLastProfileId('C:/b', 'joao')
    expect(readLastProfileId('C:/a')).toBe('maria')
    expect(readLastProfileId('C:/b')).toBe('joao')
    expect(readLastProfileId('C:/c')).toBeNull()
  })

  it('cache corrompido não derruba a tela', () => {
    localStorage.setItem('mirrormind.profile.last', 'não é json')
    expect(readLastProfileId('C:/a')).toBeNull()
    writeLastProfileId('C:/a', 'maria')
    expect(readLastProfileId('C:/a')).toBe('maria')
  })
})

describe('quem entra quando o vault abre', () => {
  const ana = perfil({ id: 'ana', name: 'Ana', isDefault: false })
  const joao = perfil({ id: 'joao', name: 'Joao', isDefault: false })

  it('conta logada manda, mesmo com vários perfis', () => {
    // A conta não diz qual perfil é dela aqui: o Rust resolve pelo vínculo da
    // identidade. O que o frontend decide é "não perguntar".
    expect(
      decideProfileOnOpen({ profiles: [ana, joao], hasAccountIdentity: true }),
    ).toEqual({ kind: 'account' })
  })

  it('sem conta, volta no último perfil do vault', () => {
    expect(
      decideProfileOnOpen({ profiles: [ana, joao], lastProfileId: 'joao', hasAccountIdentity: false }),
    ).toEqual({ kind: 'open', profileId: 'joao' })
  })

  it('último perfil com PIN não abre sozinho', () => {
    const comPin = perfil({ id: 'joao', name: 'Joao', isDefault: false, hasPin: true })
    expect(
      decideProfileOnOpen({ profiles: [ana, comPin], lastProfileId: 'joao', hasAccountIdentity: false }),
    ).toEqual({ kind: 'ask' })
  })

  it('sem memória e com dois perfis, pergunta', () => {
    expect(
      decideProfileOnOpen({ profiles: [ana, joao], lastProfileId: null, hasAccountIdentity: false }),
    ).toEqual({ kind: 'ask' })
  })

  it('memória aponta perfil que não existe mais: pergunta em vez de abrir o errado', () => {
    expect(
      decideProfileOnOpen({ profiles: [ana], lastProfileId: 'apagado', hasAccountIdentity: false }),
    ).toEqual({ kind: 'open', profileId: 'ana' })
  })

  it('vault sem perfil segue sem portão — pasta nova não vira tela de criação', () => {
    expect(decideProfileOnOpen({ profiles: [], hasAccountIdentity: false })).toEqual({
      kind: 'none',
    })
  })
})
