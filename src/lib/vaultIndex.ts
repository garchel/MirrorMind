import {
  applyWikilinkEdit,
  buildWikilinkIndex,
  getWikilinkBacklinks,
  getWikilinkTargets,
  removeWikilinkEntry,
  type WikilinkIndexSnapshot,
} from './wikilinkIndex'

// Dono unico dos caches derivados do vault em memoria.
//
// Hoje cada mutacao (excluir, renomear, salvar) re-sincroniza a mao o
// snapshot de wikilinks + o cache de conteudos no call site — esquecer um
// deles gera indice stale silencioso. Este module concentra a ordem:
// o App informa *o que mudou*, o module garante *o que invalida*.
//
// Sem IPC e sem React de proposito: efeito colateral (syncIndexadora,
// refresh, setState) continua no App a partir do que estes metodos retornam.

export type VaultIndexDocument = {
  relativePath: string
  content: string
}

export type VaultIndexRemoval = {
  /** Caminhos removidos do indice. */
  removed: string[]
  /** Origens que apontavam para os removidos (precisam de re-sync). */
  affectedSources: string[]
}

export function createVaultIndex() {
  let snapshot: WikilinkIndexSnapshot | null = null
  let documents: Map<string, VaultIndexDocument> | null = null
  let vaultPath: string | null = null

  return {
    /** Snapshot atual (null = ainda nao indexado ou invalidado). */
    getSnapshot(): WikilinkIndexSnapshot | null {
      return snapshot
    },

    /** Cache de conteudos da ultima leitura unificada (null = stale). */
    getDocuments(): Map<string, VaultIndexDocument> | null {
      return documents
    },

    getVaultPath(): string | null {
      return vaultPath
    },

    /** Reconstrucao total apos leitura unificada (`read_vault_notes`). */
    rebuild(path: string, docs: VaultIndexDocument[]): void {
      vaultPath = path
      snapshot = buildWikilinkIndex(docs)
      documents = new Map(docs.map((doc) => [doc.relativePath, doc]))
    },

    /** Invalida tudo (falha de indexacao, troca de vault). */
    clear(): void {
      snapshot = null
      documents = null
      vaultPath = null
    },

    /** Marca o cache de conteudos como stale, mantendo o indice. */
    markDocumentsStale(): void {
      documents = null
    },

    /**
     * Remove notas do indice (exclusao de nota ou pasta).
     * Retorna os removidos + as origens afetadas para re-sync.
     * O cache de conteudos perde a validade junto.
     */
    removePaths(isDeletedPath: (path: string) => boolean): VaultIndexRemoval {
      const removed: string[] = []
      const affectedSources = new Set<string>()
      if (snapshot) {
        for (const path of snapshot.entries.keys()) {
          if (!isDeletedPath(path)) continue
          removed.push(path)
          for (const source of snapshot.backlinks.get(path) ?? []) affectedSources.add(source)
        }
        for (const path of removed) snapshot = removeWikilinkEntry(snapshot, path)
      }
      documents = null
      return { removed, affectedSources: [...affectedSources].sort() }
    },

    /**
     * Reindexa apos renomear/mover: remove o caminho antigo e registra o
     * novo com o mesmo conteudo (somente notas). O cache perde a validade.
     */
    remapPaths(remapPath: (path: string) => string): void {
      if (snapshot) {
        const affected = [...snapshot.entries.keys()].filter((path) => remapPath(path) !== path)
        let next = snapshot
        for (const path of affected) {
          const entry = next.entries.get(path)
          next = removeWikilinkEntry(next, path)
          if (entry) next = applyWikilinkEdit(next, remapPath(path), entry.version)
        }
        snapshot = next
      }
      documents = null
    },

    /** Recalcula somente a nota salva (incremental, sem rebuild). */
    applyEdit(relativePath: string, content: string): void {
      if (snapshot) snapshot = applyWikilinkEdit(snapshot, relativePath, content)
    },

    backlinks(relativePath: string): string[] {
      return snapshot ? getWikilinkBacklinks(snapshot, relativePath) : []
    },

    targets(relativePath: string): string[] {
      return snapshot ? getWikilinkTargets(snapshot, relativePath) : []
    },
  }
}

export type VaultIndex = ReturnType<typeof createVaultIndex>
