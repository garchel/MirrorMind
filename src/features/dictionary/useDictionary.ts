import { useCallback, useEffect, useMemo, useState } from 'react'
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
 * componente, e a mudanca de Vault e o que dispara a recarga. A releitura e
 * incondicional: o cleanup marca a rodada anterior como obsoleta, e so a
 * rodada mais recente aplica o resultado.
 */
export function useDictionary(
  vaultPath: string | undefined,
  engine: DictionaryEngine = defaultDictionaryEngine,
) {
  const [entries, setEntries] = useState<DictionaryEntry[]>([])
  // True até a primeira leitura do Vault resolver (ou falhar). A página usa
  // isto para mostrar um esqueleto em vez de um vazio que ainda não é
  // verdade — "Nenhum conceito" piscado antes do arquivo abrir mentia.
  const [loading, setLoading] = useState(true)
  // **Falha de carregar** o dicionário. A falha de gravar é devolvida por
  // exceção ao chamador, e mostrada no formulário: são situações
  // diferentes, e juntar as duas mostraria a mesma mensagem duas vezes.
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)

  // Cada rodada do efeito le o dicionario do Vault aberto. Nao ha
  // "ja li este Vault" para pular: o cleanup marca a rodada obsoleta
  // (`cancelled`) e e ela quem descarta a resposta velha. Um guard manual
  // aqui prende a pagina no esqueleto sob StrictMode — a primeira passada
  // e cancelada pelo cleanup e a segunda entrava achando que ja estava
  // carregada, e `loading` nunca voltava a false.
  useEffect(() => {
    if (!vaultPath) {
      setEntries([])
      setLoading(false)
      return
    }
    let cancelled = false
    // Trocar de Vault precisa voltar ao esqueleto: a lista antiga ficaria
    // visível com o dicionário do Vault anterior enquanto o novo carrega.
    setLoading(true)
    void engine
      .entries(vaultPath)
      .then((snapshot) => {
        if (!cancelled) {
          setEntries(snapshot.entries)
          setLoadError('')
          setLoading(false)
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setEntries([])
          setLoadError(readableDictionaryFailure(failure))
          setLoading(false)
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
    async (
      term: string,
      concept: string,
      origin?: { notePath: string; context: string },
    ) => {
      if (!vaultPath) return
      setBusy(true)
      try {
        // Sem `origin` a chamada mantém a assinatura de 3 argumentos: a
        // página do dicionário não tem nota de origem.
        const snapshot = origin
          ? await engine.save(vaultPath, term, concept, origin)
          : await engine.save(vaultPath, term, concept)
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

  return { entries, index, find, save, remove, error: loadError, busy, loading }
}

export type UseDictionary = ReturnType<typeof useDictionary>
