/** Helpers puros da pagina Bases: tabela de notas com as propriedades do
 * frontmatter como colunas (estilo Obsidian Bases). Formatacao de celula,
 * colunas dinamicas, ordenacao e filtro ficam aqui para serem testaveis. */
import type { FrontmatterValue } from '../../lib/markdown'

/** Uma linha da tabela: nota + propriedades extraidas do frontmatter. */
export type BaseRow = {
  relativePath: string
  name: string
  properties: Record<string, FrontmatterValue>
}

/** Coluna da tabela: chave da propriedade (ou coluna especial de nome). */
export type BaseColumn = {
  /** Chave da propriedade no frontmatter, ou NOME_COLUMN para o nome. */
  key: string
  /** Rotulo exibido no cabecalho. */
  label: string
  /** Propriedades usam a chave crua; o nome da nota e a coluna especial. */
  kind: 'name' | 'property'
}

export const NAME_COLUMN_KEY = '__name__'

/** Ordena as chaves de propriedade para as colunas da Tabela: primeiro as
 * encontradas nas notas (ordem de primeira aparicao), depois as propriedades
 * comuns (menu do header) que ainda nao existem em nenhuma nota — assim a
 * tabela so mostra colunas comuns vazias quando o usuario as escolher no
 * seletor de colunas. */
export function orderedPropertyKeys(
  fromNotes: readonly string[],
  commonKeys: readonly string[],
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const key of fromNotes) {
    if (!seen.has(key)) {
      seen.add(key)
      result.push(key)
    }
  }
  for (const key of commonKeys) {
    if (!seen.has(key)) {
      seen.add(key)
      result.push(key)
    }
  }
  return result
}

/** Chave do localStorage onde a personalizacao de colunas e salva (por vault). */
export function columnPickerStorageKey(vaultPath: string): string {
  return `mirrormind.bases.columns.${vaultPath}`
}

/** Le as chaves de colunas salvas no localStorage. Devolve `null` quando o
 * usuario nunca personalizou (mostrar todas) ou o valor salvo e invalido. */
export function readSavedColumnKeys(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const keys = parsed.filter((key): key is string => typeof key === 'string' && key.length > 0)
    return keys
  } catch {
    return null
  }
}

/** Converte um valor de propriedade para texto exibivel na celula. Listas
 * viram itens separados por virgula; objetos viram pares chave: valor. */
export function frontmatterValueToText(value: FrontmatterValue | undefined, depth = 0): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Guarda contra estruturas ciclicas (ex.: alias YAML autorreferente) e
  // profundidade excessiva: corta a formatacao sem recursao infinita.
  if (depth > 4) return '…'
  if (Array.isArray(value)) return value.map((item) => frontmatterValueToText(item, depth + 1)).filter(Boolean).join(', ')
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${frontmatterValueToText(item, depth + 1)}`)
    .join(', ')
}

/** Coleciona as colunas do conjunto de linhas: o nome primeiro e as
 * propriedades na ordem de primeira aparicao, com contagem de notas que
 * possuem cada propriedade. */
export function collectColumns(rows: readonly BaseRow[]): BaseColumn[] {
  const seen = new Set<string>()
  const columns: BaseColumn[] = [{ key: NAME_COLUMN_KEY, label: 'Nota', kind: 'name' }]
  for (const row of rows) {
    for (const key of Object.keys(row.properties)) {
      if (seen.has(key)) continue
      seen.add(key)
      columns.push({ key, label: key, kind: 'property' })
    }
  }
  return columns
}

/** Valor de uma celula (para comparacao na ordenacao). */
function cellValue(row: BaseRow, column: BaseColumn): FrontmatterValue {
  if (column.kind === 'name') return row.name.replace(/\.md$/i, '')
  return row.properties[column.key]
}

/** Compara dois valores de propriedade: numeros numericamente, o resto por
 * texto normalizado (case-insensitive). */
function compareValues(left: FrontmatterValue | undefined, right: FrontmatterValue | undefined): number {
  const leftText = frontmatterValueToText(left).toLowerCase()
  const rightText = frontmatterValueToText(right).toLowerCase()
  if (leftText === rightText) return 0
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return leftText < rightText ? -1 : 1
}

/** Ordena as linhas pela coluna (ascendente/descendente), estavel e sem
 * mutar a entrada. Linhas sem valor na propriedade ficam no fim. */
export function sortRows(
  rows: readonly BaseRow[],
  column: BaseColumn,
  direction: 'asc' | 'desc',
): BaseRow[] {
  const withValue = rows.filter((row) => frontmatterValueToText(cellValue(row, column)) !== '')
  const withoutValue = rows.filter((row) => frontmatterValueToText(cellValue(row, column)) === '')
  const sorted = [...withValue].sort((left, right) => {
    const comparison = compareValues(cellValue(left, column), cellValue(right, column))
    return direction === 'asc' ? comparison : -comparison
  })
  return direction === 'asc' ? [...sorted, ...withoutValue] : [...withoutValue, ...sorted]
}

/** Filtra linhas pela busca: nome, caminho ou qualquer valor de propriedade
 * contem o termo (case-insensitive). */
export function filterRows(rows: readonly BaseRow[], query: string): BaseRow[] {
  const term = query.trim().toLowerCase()
  if (!term) return [...rows]
  return rows.filter((row) => {
    if (row.name.toLowerCase().includes(term)) return true
    if (row.relativePath.toLowerCase().includes(term)) return true
    return Object.values(row.properties).some((value) => frontmatterValueToText(value).toLowerCase().includes(term))
  })
}
