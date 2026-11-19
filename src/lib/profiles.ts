/**
 * Perfis locais: cliente IPC e a memória de "quem usou este vault por último".
 *
 * O perfil vive no vault (`<vault>/.mirmind/profiles.json`), não na máquina —
 * levar a pasta para outro computador leva junto quem estuda ali. O que fica na
 * máquina é só a preferência de qual perfil abrir primeiro naquele vault.
 */

export type ProfileSummary = {
  id: string
  name: string
  /** Token de cor do app (ex.: "sage", "brick"). */
  color: string
  isDefault: boolean
  hasPin: boolean
}

export type ProfileInput = {
  name: string
  color: string
  /** Sem PIN o perfil abre direto; com PIN, a troca pede o número. */
  pin?: string | null
}

type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

/** Cliente pronto com o IPC do app (o mesmo `invoke` normalizado das outras telas). */
export function profileClientFromInvoke(
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>,
): ProfileClient {
  return createProfileClient(invoke as InvokeFn)
}

export type ProfileClient = {
  list(vaultRoot: string): Promise<ProfileSummary[]>
  create(vaultRoot: string, input: ProfileInput): Promise<ProfileSummary>
  rename(vaultRoot: string, id: string, input: ProfileInput): Promise<ProfileSummary>
  remove(vaultRoot: string, id: string): Promise<void>
  setPin(vaultRoot: string, id: string, pin: string | null): Promise<void>
  verifyPin(vaultRoot: string, id: string, pin: string): Promise<boolean>
  /** Marca o perfil ativo no processo do app (os caminhos passam a ser os dele). */
  select(id: string): Promise<void>
}

const LAST_PROFILE_KEY = 'mirrormind.profile.last'

export function createProfileClient(invoke: InvokeFn): ProfileClient {
  return {
    list: (vaultRoot) => invoke<ProfileSummary[]>('profiles_list', { vaultRoot }),
    create: (vaultRoot, input) =>
      invoke<ProfileSummary>('profiles_create', {
        vaultRoot,
        name: input.name,
        color: input.color,
        pin: input.pin ?? null,
      }),
    rename: (vaultRoot, id, input) =>
      invoke<ProfileSummary>('profiles_rename', {
        vaultRoot,
        id,
        name: input.name,
        color: input.color,
      }),
    remove: (vaultRoot, id) => invoke<void>('profiles_delete', { vaultRoot, id }),
    setPin: (vaultRoot, id, pin) => invoke<void>('profiles_set_pin', { vaultRoot, id, pin }),
    verifyPin: (vaultRoot, id, pin) =>
      invoke<boolean>('profiles_verify_pin', { vaultRoot, id, pin }),
    select: (id) => invoke<void>('profiles_select', { id }),
  }
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_PROFILE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** Qual perfil abrir por padrão neste vault (gravado na máquina). */
export function readLastProfileId(vaultRoot: string): string | null {
  return readMap()[vaultRoot] ?? null
}

export function writeLastProfileId(vaultRoot: string, profileId: string) {
  try {
    const map = readMap()
    map[vaultRoot] = profileId
    localStorage.setItem(LAST_PROFILE_KEY, JSON.stringify(map))
  } catch {
    // Sem localStorage o app continua: só perde a conveniência de lembrar.
  }
}

/**
 * Decide se a tela "Quem está usando?" aparece ao abrir o vault.
 *
 * - um perfil só, sem PIN: entra direto (não vale interromper quem usa sozinho);
 * - com PIN: pergunta sempre, senão o PIN não protege nada;
 * - dois ou mais: pergunta sempre, porque a escolha muda o histórico mostrado.
 */
export function needsProfileChoice(profiles: ProfileSummary[]): boolean {
  if (profiles.length === 0) return false
  if (profiles.length === 1) return profiles[0].hasPin
  return true
}
