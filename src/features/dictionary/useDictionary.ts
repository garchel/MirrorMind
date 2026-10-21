import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createDictionaryEngine,
  readableDictionaryFailure,
  type DictionaryEngine,
} from './dictionaryEngine'
import {
  indexDictionary,
  normalizeTerm,
  type DictionaryEntry,
} from './dictionarySchema'

/**
 * A engine padrão, criada **uma vez**.
 *
 * Fora do componente, e nao como default parameter: um default parameter que
 * chama uma fabrica e avaliado a cada render, e o objeto novo a cada render
 * quebraria a identidade que o `useEffect` usa para nao repetir a leitura.
 */
const defaultDictionaryEngine = createDictionaryEngine()

/**
 * Estado do dicionário de conceitos para o Vault aberto.
 *
 * ## Por que o estado vive aqui, e não num contexto global
 *
 * O dicionário é **por Vault** (o mesmo motivo do §5.3 do plano para a
 * estratégia de calibração): o conceito de "rubisco" na biologia não é o
 * conceito de "rubisco" na física. Um estado global permitiria mostrar a
 * definição do Vault A numa nota do Vault B.
 *
 * ## Por que o dicionário indexado é um `Map`
 *
 * O hover roda a cada movimento do mouse sobre a nota. Com um `Map`, casar
 * a palavra sob o cursor é `O(1)`; com uma lista, seria uma varredura a
 * cada pixel — e o dicionário cresce com o uso.
 *
 * ## A engine precisa ser estavel
 *
 * O `engine` entra nas dependencias do `useEffect`. Se ele fosse criado a
 * cada render (o que acontece com um default parameter que chama uma
 * fabrica), o efeito rodaria sem parar — e cada ciclo dispararia uma
 * leitura do dicionário. Por isso a enginepadrao vive **fora** do
 * componente, e a mudanca de Vault e o que dispara a recarga.
 */
export function useDictionary(
  vaultPath: string | undefined,
  engine: DictionaryEngine = defaultDictionaryEngine,
) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  // **Falha de carregar** o dicionário. A falha de gravar é devolvida por
  // exceção ao chamador, e mostrada no formulário: são situações
  // diferentes, e juntar as duas mostraria a mesma mensagem duas vezes.
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  // Guarda o Vault da última carga. Trocar de Vault precisa recarregar, e
  // sem isso a página mostraria o dicionário do Vault anterior.
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    if (!vaultPath) {
      loadedFor.current = null
      setEntries([])
      return
    }
    if (loadedFor.current === vaultPath) return
    loadedFor.current = vaultPath
    let cancelled = false
    void engine
      .entries(vaultPath)
      .then((snapshot) => {
        if (!cancelled) {
          setEntries(snapshot.entries)
          setLoadError('')
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setEntries([])
          setLoadError(readableDictionaryFailure(failure))
        }
      })
    return () => {
      cancelled = true
    }
  }, [vaultPath, engine])

  const index = useMemo(() => indexDictionary(entries), [entries])

  /** O verbete de um termo, se existir. */
  const find = useCallback(
    (term: string): DictionaryEntry | undefined => index.get(normalizeTerm(term)),
    [index],
  )

  /** Registra ou atualiza um verbete. */
  const save = useCallback(
    async (term: string, concept: string) => {
      if (!vaultPath) return
      setBusy(true)
      try {
        const snapshot = await engine.save(vaultPath, term, concept)
        setEntries(snapshot.entries)
      } finally {
        setBusy(false)
      }
    },
    [vaultPath, engine],
  )

  /** Apaga um verbete. */
  const remove = useCallback(
    async (term: string) => {
      if (!vaultPath) return
      setBusy(true)
      try {
        const snapshot = await engine.remove(vaultPath, term)
        setEntries(snapshot.entries)
      } finally {
        setBusy(false)
      }
    },
    [vaultPath, engine],
  )

  return { entries, index, find, save, remove, error: loadError, busy }
}

export type UseDictionary = ReturnType<typeof useDictionary>
