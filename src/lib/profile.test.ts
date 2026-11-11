import { describe, expect, it } from 'vitest'
import { deriveProfile, initialsFrom } from './profile'
import { ANON_SESSION, type SessionSnapshot } from './session'

const authSession = (email: string): SessionSnapshot => ({
  status: 'auth',
  email,
  expiresAtUnixMs: null,
})

describe('initialsFrom', () => {
  it('usa as iniciais de duas partes', () => {
    expect(initialsFrom('paulo.victor@exemplo.com')).toBe('PV')
    expect(initialsFrom('Conta local')).toBe('CL')
    expect(initialsFrom('ana-maria@x')).toBe('AM')
  })

  it('usa as duas primeiras letras quando nao ha separador', () => {
    expect(initialsFrom('paulo@exemplo.com')).toBe('PA')
    expect(initialsFrom('Ana')).toBe('AN')
  })

  it('cai no marcador quando o valor e vazio ou so simbolos', () => {
    expect(initialsFrom('')).toBe('?')
    expect(initialsFrom('@exemplo.com')).toBe('?')
  })
})

describe('deriveProfile', () => {
  it('autenticado: email como nome e plano resolvido', () => {
    expect(deriveProfile(authSession('paulo.victor@exemplo.com'), 'ia_mensal')).toEqual({
      name: 'paulo.victor@exemplo.com',
      initials: 'PV',
      planLabel: 'IA Mensal',
      signedIn: true,
    })
  })

  it('anonimo: conta local e plano gratis', () => {
    expect(deriveProfile(ANON_SESSION, 'gratis')).toEqual({
      name: 'Conta local',
      initials: 'CL',
      planLabel: 'Grátis',
      signedIn: false,
    })
  })

  it('status auth sem email continua anonimo', () => {
    const profile = deriveProfile({ status: 'auth', email: null, expiresAtUnixMs: null }, 'gratis')
    expect(profile.signedIn).toBe(false)
    expect(profile.name).toBe('Conta local')
  })
})
