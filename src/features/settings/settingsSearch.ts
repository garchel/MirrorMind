import { createContext, useContext } from 'react'

/**
 * Busca interna das Configurações.
 *
 * A command palette leva à seção; ela não sabe onde fica um controle. Com ~24
 * controles diretos (e centenas dentro dos blocos embutidos), "onde fica X"
 * virava tentativa e erro. A busca aqui é de contexto: cada linha e cada seção
 * se comparam com o termo e se escondem sozinhas.
 */
export type SettingsSearchValue = { query: string }

export const SettingsSearchContext = createContext<SettingsSearchValue>({ query: '' })

/** Compara sem acento e sem caixa: "aparencia" acha "Aparência". */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function matchesQuery(query: string, ...texts: string[]): boolean {
  const needle = normalizeSearch(query)
  if (!needle) return true
  return texts.some((text) => normalizeSearch(text).includes(needle))
}

export function useSettingsSearch(): SettingsSearchValue {
  return useContext(SettingsSearchContext)
}
