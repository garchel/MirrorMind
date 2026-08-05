import { extractObsidianWikiLinks, resolveObsidianWikiLinkPath } from './markdown'

// Indice escalavel de wikilinks em memoria.
//
// O grafo e o autocomplete precisam saber quais notas apontam para quais notas.
// Antes, cada render do grafo reextraia e re-resolvia os wikilinks de TODAS as
// notas e cada abertura de backlinks varria o vault no disco. Este indice
// mantem o grafo de conexoes em RAM e so recalcula uma nota quando o conteudo
// dela muda (por assinatura), invalidando apenas as notas afetadas.

export type WikilinkIndexEntry = {
  /** Versao do conteudo que gerou esta entrada (cache de invalidacao). */
  version: string
  /** Alvos (resolvidos para o caminho real da nota, quando existente). */
  targets: string[]
  /** Alvos brutos extraidos do Markdown (para re-resolucao barata). */
  rawTargets: string[]
}

export type WikilinkIndexSnapshot = {
  entries: Map<string, WikilinkIndexEntry>
  /** indices invertidos: alvo -> origens */
  backlinks: Map<string, Set<string>>
}

function extractRawTargets(content: string): string[] {
  const seen = new Set<string>()
  const targets: string[] = []
  for (const link of extractObsidianWikiLinks(content)) {
    if (link.path && !seen.has(link.path)) {
      seen.add(link.path)
      targets.push(link.path)
    }
  }
  return targets
}

/**
 * Construtor de um indice em memoria a partir das notas e seus conteudos.
 *
 * - `notes`: pares `{ relativePath, content }` de todas as notas do Vault.
 * - `availablePaths`: caminhos existentes (para resolver wikilinks relativos,
 *   por pasta e por basename). Quando omitido, usa os proprios caminhos do
 *   indice.
 */
export function buildWikilinkIndex(
  notes: Array<{ relativePath: string; content: string }>,
  availablePaths?: string[],
): WikilinkIndexSnapshot {
  const paths = availablePaths ?? notes.map((note) => note.relativePath)
  const entries = new Map<string, WikilinkIndexEntry>()

  for (const note of notes) {
    const rawTargets = extractRawTargets(note.content)
    const targets = rawTargets.map((target) => resolveObsidianWikiLinkPath(target, note.relativePath, paths))
    entries.set(note.relativePath, {
      version: note.content,
      targets,
      rawTargets,
    })
  }

  return { entries, backlinks: computeBacklinks(entries) }
}

/**
 * Aplica uma edicao ao indice, recalculando SOMENTE a nota alterada.
 * Retorna o indice atualizado (mesma instancia de `entries`, nova de backlinks).
 */
export function applyWikilinkEdit(
  snapshot: WikilinkIndexSnapshot,
  relativePath: string,
  content: string,
  availablePaths?: string[],
): WikilinkIndexSnapshot {
  const existing = snapshot.entries.get(relativePath)
  if (existing && existing.version === content) return snapshot

  const paths = availablePaths ?? [...snapshot.entries.keys()]
  const rawTargets = extractRawTargets(content)
  const targets = rawTargets.map((target) => resolveObsidianWikiLinkPath(target, relativePath, paths))
  const entries = new Map(snapshot.entries)
  entries.set(relativePath, { version: content, targets, rawTargets })

  return { entries, backlinks: computeBacklinks(entries) }
}

/** Remove uma nota do indice (nota apagada ou renomeada). */
export function removeWikilinkEntry(
  snapshot: WikilinkIndexSnapshot,
  relativePath: string,
): WikilinkIndexSnapshot {
  if (!snapshot.entries.has(relativePath)) return snapshot
  const entries = new Map(snapshot.entries)
  entries.delete(relativePath)
  return { entries, backlinks: computeBacklinks(entries) }
}

function computeBacklinks(entries: Map<string, WikilinkIndexEntry>) {
  const backlinks = new Map<string, Set<string>>()
  for (const [source, entry] of entries) {
    for (const target of entry.targets) {
      let set = backlinks.get(target)
      if (!set) {
        set = new Set<string>()
        backlinks.set(target, set)
      }
      set.add(source)
    }
  }
  return backlinks
}

/** Notas que apontam para `relativePath` (ordem estavel por caminho). */
export function getWikilinkBacklinks(snapshot: WikilinkIndexSnapshot, relativePath: string): string[] {
  return [...(snapshot.backlinks.get(relativePath) ?? [])].sort()
}

/** Alvos validos (que existem no Vault) apontados por `relativePath`. */
export function getWikilinkTargets(snapshot: WikilinkIndexSnapshot, relativePath: string): string[] {
  const existing = new Set(snapshot.entries.keys())
  return (snapshot.entries.get(relativePath)?.targets ?? []).filter((target) => existing.has(target))
}

/** Numero total de conexoes no indice (soma dos graus de saida). */
export function countWikilinkEdges(snapshot: WikilinkIndexSnapshot): number {
  let total = 0
  for (const entry of snapshot.entries.values()) total += entry.targets.length
  return total
}
