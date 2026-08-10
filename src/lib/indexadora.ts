import { getMarkdownFrontmatterPropertySource, setMarkdownFrontmatterPropertySource } from './markdown'

// Nota indexadora: uma nota que lista automaticamente, uma por linha, as notas
// que criaram um link para ela. O estado vive no frontmatter (`indexadora:
// true`) e a lista gerada fica numa secao marcada no fim da nota, para que a
// sincronizacao seja idempotente (acha o marcador e substitui o bloco).

export const INDEXADORA_PROPERTY = 'indexadora'
export const INDEXADORA_HEADING = '## Índice'
export const INDEXADORA_MARKER = '<!-- indexadora -->'

/** True quando o frontmatter declara `indexadora: true`. */
export function isIndexadora(content: string): boolean {
  return getMarkdownFrontmatterPropertySource(content, INDEXADORA_PROPERTY)?.trim().toLowerCase() === 'true'
}

/** Liga/desliga a flag no frontmatter (mantendo o resto do arquivo intacto). */
export function setIndexadoraFlag(content: string, enabled: boolean): string {
  return setMarkdownFrontmatterPropertySource(content, INDEXADORA_PROPERTY, enabled ? 'true' : 'false').content
}

/** Um link por linha, no formato [[caminho sem .md]] (convencao do app). */
function buildSectionLines(backlinks: string[]): string[] {
  return [...backlinks].sort().map((path) => `[[${path.replace(/\.md$/i, '')}]]`)
}

/** Fonte da secao gerada (vazia quando nao ha links). */
export function indexadoraSectionSource(backlinks: string[]): string {
  const links = buildSectionLines(backlinks)
  if (links.length === 0) return ''
  return `${INDEXADORA_HEADING}\n${INDEXADORA_MARKER}\n${links.join('\n')}\n`
}

/**
 * Remove a secao gerada do conteudo. Localiza o marcador; inclui o cabecalho
 * `## Índice` quando imediatamente acima; remove tambem as linhas seguintes
 * (links e linhas em branco) ate encontrar conteudo diferente. Conteudo do
 * usuario sem o marcador nunca e alterado.
 */
export function removeIndexadoraSection(content: string): string {
  const lines = content.split(/\r?\n/)
  const markerIndex = lines.findIndex((line) => line.trim() === INDEXADORA_MARKER)
  if (markerIndex === -1) return content

  let start = markerIndex
  if (markerIndex > 0 && lines[markerIndex - 1]!.trim() === INDEXADORA_HEADING) start = markerIndex - 1

  let end = markerIndex + 1
  while (end < lines.length) {
    const trimmed = lines[end]!.trim()
    if (trimmed === '' || /^\[\[[^\]]+\]\]$/.test(trimmed)) end += 1
    else break
  }

  const remaining = [...lines.slice(0, start), ...lines.slice(end)]
  const joined = remaining.join('\n')
  if (joined.trim() === '') return ''
  return `${joined.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`
}

/**
 * Garante que o conteudo termina com a secao gerada refletindo `backlinks`.
 * Idempotente: remove a secao antiga (se existir) e reescreve com os links
 * atuais; com backlinks vazios, apenas remove a secao.
 */
export function syncIndexadoraSection(content: string, backlinks: string[]): string {
  const cleaned = removeIndexadoraSection(content)
  const section = indexadoraSectionSource(backlinks)
  if (!section) return cleaned
  if (cleaned === '') return section
  const base = cleaned.endsWith('\n') ? cleaned : `${cleaned}\n`
  return `${base}${section}`
}
