import { PLANS, type PlanId } from './billing'
import type { SessionSnapshot } from './session'

/** Identidade exibida no rodape de perfil (nome/plano/avatar). */
export type ProfileIdentity = {
  /** Nome exibido: o email quando autenticado; "Conta local" quando anonimo. */
  name: string
  /** 1-2 letras para o avatar (sem foto de perfil no app). */
  initials: string
  /** Nome do plano atual (Grátis, IA Mensal, IA Anual). */
  planLabel: string
  signedIn: boolean
}

export function deriveProfile(session: SessionSnapshot, plan: PlanId): ProfileIdentity {
  const email = session.email?.trim() ?? ''
  const signedIn = session.status === 'auth' && email.length > 0
  const name = signedIn ? email : 'Conta local'
  return {
    name,
    initials: initialsFrom(name),
    planLabel: PLANS[plan].name,
    signedIn,
  }
}

/**
 * Iniciais para o avatar: "paulo.victor@x" -> "PV"; "Conta local" -> "CL";
 * um unico nome sem separador usa as duas primeiras letras.
 */
export function initialsFrom(value: string): string {
  const local = value.includes('@') ? value.slice(0, value.indexOf('@')) : value
  const parts = local.split(/[.\s_-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  const compact = local.replace(/[^\p{L}\p{N}]/gu, '')
  return compact.slice(0, 2).toUpperCase() || '?'
}
