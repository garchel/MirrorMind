/** Indice em memoria das tags por nota, com invalidacao incremental por versao
 * de conteudo: cada nota extrai suas tags uma unica vez por versao do documento
 * (comparacao de string do conteudo) e o resultado e reutilizado no explorador,
 * autocomplete, nota ativa e grafo — evitando reprocessar YAML/Markdown a cada
 * renderizacao do grafo. Atualizacoes recalculam somente as notas afetadas. */
import { extractMarkdownTags } from './markdown'

export type TagDocument = {
  relativePath: string
  content: string
}

export class TagIndex {
  private tagsByPath = new Map<string, string[]>()
  private contentByPath = new Map<string, string>()

  /** Sincroniza o indice com o conjunto atual de documentos: extrai tags
   * somente das notas cujo conteudo mudou desde a ultima sync e remove as
   * notas que sumiram. Devolve os caminhos realmente recalculados (util para
   * invalidar dependentes sem reprocessar o conjunto inteiro). */
  sync(documents: readonly TagDocument[]): string[] {
    const seen = new Set<string>()
    const recalculated: string[] = []
    for (const document of documents) {
      seen.add(document.relativePath)
      if (this.contentByPath.get(document.relativePath) === document.content) continue
      this.tagsByPath.set(document.relativePath, extractMarkdownTags(document.content))
      this.contentByPath.set(document.relativePath, document.content)
      recalculated.push(document.relativePath)
    }
    for (const path of [...this.contentByPath.keys()]) {
      if (!seen.has(path)) {
        this.contentByPath.delete(path)
        this.tagsByPath.delete(path)
      }
    }
    return recalculated
  }

  /** Tags de uma nota (ordem de extracao preservada; lista nova por leitura). */
  tagsOf(relativePath: string): string[] {
    return this.tagsByPath.get(relativePath) ?? []
  }

  /** A nota esta presente no indice? */
  has(relativePath: string): boolean {
    return this.tagsByPath.has(relativePath)
  }

  /** Uniao ordenada de todas as tags do indice. */
  allTags(): string[] {
    return [...new Set([...this.tagsByPath.values()].flat())].sort()
  }

  /** Numero de notas no indice (diagnostico/testes). */
  get size(): number {
    return this.tagsByPath.size
  }
}
