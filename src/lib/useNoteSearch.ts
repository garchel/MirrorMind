import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export type NoteSearchResult = { name: string; relativePath: string; excerpt: string }

/** Busca debounced de notas no vault (`search_notes`).
 *
 * Extraído do `App.tsx`: o estado de resultados + o efeito com timeout de
 * 150ms viram um hook puro de `(caminho do vault, query, habilitado)`.
 * Semântica idêntica: desabilitado/sem vault/query vazia = lista vazia;
 * falha de backend = lista vazia (nunca vaza erro para a busca).
 */
export function useNoteSearch(
  vaultPath: string | null,
  query: string,
  enabled: boolean,
  debounceMs = 150,
): NoteSearchResult[] {
  const [results, setResults] = useState<NoteSearchResult[]>([])

  useEffect(() => {
    if (!enabled || !vaultPath || !query.trim()) {
      setResults([])
      return
    }
    const timeout = window.setTimeout(() => {
      void invoke<NoteSearchResult[]>('search_notes', { path: vaultPath, query })
        .then(setResults)
        .catch(() => setResults([]))
    }, debounceMs)
    return () => window.clearTimeout(timeout)
  }, [query, enabled, vaultPath, debounceMs])

  return results
}
