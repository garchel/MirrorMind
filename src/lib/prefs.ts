import { useCallback, useEffect, useState } from 'react'

/** Camada única de preferências do MirrorMind.
 *
 * Antes: 31 chaves `mirrormind.*` espalhadas pelo app com
 * `localStorage.getItem/setItem` direto — sem validação, sem reatividade
 * entre componentes e sem versionamento. Este módulo centraliza o acesso
 * com a mesma chave (compatível com dados existentes) e adiciona:
 *
 * - parsing/clamp via um `parse` fornecido (nunca confiar no que está
 *   gravado: chave corrompida = valor padrão, não crash);
 * - reatividade: componentes lendo a mesma chave re-renderizam quando
 *   ela muda (evento custom, funciona entre componentes);
 * - `vaultScoped`: prefixa com o hash do caminho do vault para
 *   preferências que não devem vazar entre vaults.
 *
 * Os ids continuam os mesmos (`mirrormind.*`), então nada precisa ser
 * migrado — chaves legadas continuam válidas.
 */

const EVENT = 'mirrormind-pref-change'

function keyFor(id: string, vaultKey?: string | null): string {
  if (!vaultKey) return id
  // Hash curto e estável do caminho do vault no id (FNV-1a 32-bit).
  let hash = 0x811c9dc5
  for (let i = 0; i < vaultKey.length; i += 1) {
    hash ^= vaultKey.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${id}@${(hash >>> 0).toString(36)}`
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* localStorage indisponível (modo privado, cota): prefira degradar
     * silenciosamente a quebrar o app por uma preferência. */
  }
}

/** Lê uma preferência com parse seguro (valor padrão em qualquer erro). */
export function readPref<T>(id: string, fallback: T, parse: (raw: string) => T, vaultKey?: string | null): T {
  const raw = readRaw(keyFor(id, vaultKey))
  if (raw === null) return fallback
  try {
    return parse(raw)
  } catch {
    return fallback
  }
}

/** Grava uma preferência e notifica os hooks da mesma chave. */
export function writePref<T>(id: string, value: T, serialize: (value: T) => string, vaultKey?: string | null): void {
  writeRaw(keyFor(id, vaultKey), serialize(value))
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }))
}

/** Hook reativo de preferência: `[valor, setValue]`.
 *
 * `parse`/`serialize` são aplicados fora do hook: o chamador define uma
 * vez (module scope) e o hook não re-renderiza por identidade de função.
 */
export function usePref<T>(id: string, fallback: T, parse: (raw: string) => T, serialize: (value: T) => string, vaultKey?: string | null): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(id, fallback, parse, vaultKey))

  useEffect(() => {
    function onChange(event: Event) {
      if ((event as CustomEvent<string>).detail === id) {
        setValue(readPref(id, fallback, parse, vaultKey))
      }
    }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
    // parse/fallback são estáveis (module scope) por contrato; id/vaultKey
    // mudam apenas ao trocar de vault, quando reler é desejado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, vaultKey])

  // Troca de vault: reler a chave com o novo escopo.
  useEffect(() => {
    setValue(readPref(id, fallback, parse, vaultKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKey])

  const update = useCallback((next: T) => {
    writePref(id, next, serialize, vaultKey)
    setValue(next)
  }, [id, vaultKey, serialize])

  return [value, update]
}

// ---- Parsers comuns (module scope: estáveis entre renders) ----
// O fallback é sempre passado direto em `readPref`/`usePref`; os parsers
// apenas validam/convertem o valor cru (throw = usa fallback).

export const parseBoolean = (raw: string) => {
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error('valor inválido')
}
export const serializeBoolean = String

export const parseNumber = (clamp: [number, number]) => (raw: string) => {
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('valor inválido')
  return Math.min(clamp[1], Math.max(clamp[0], value))
}
export const serializeNumber = String

export const parseNonEmptyString = (raw: string) => {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('valor inválido')
  return raw
}
export const serializeString = (value: string) => value

export function parseJson<T>(raw: string): T {
  const parsed = JSON.parse(raw) as T
  if (parsed === null || typeof parsed !== 'object') throw new Error('valor inválido')
  return parsed
}
export const serializeJson = JSON.stringify
