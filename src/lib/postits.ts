import { stringify } from 'yaml'
import {
  getMarkdownFrontmatterProperties,
  removeMarkdownFrontmatterProperty,
  setMarkdownFrontmatterPropertySource,
} from './markdown'

/** Cores validas do post-it — as mesmas cinco pastilhas do marca-texto. */
export type PostitColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange'

/** Rotulos das cores no popover (tooltip, aria-label e hint da cor ativa). */
export const POSTIT_COLOR_LABELS: Record<PostitColor, string> = {
  yellow: 'Amarelo',
  green: 'Verde',
  blue: 'Azul',
  pink: 'Rosa',
  orange: 'Laranja',
}

export const POSTIT_COLORS: PostitColor[] = ['yellow', 'green', 'blue', 'pink', 'orange']

export const POSTIT_COLOR_HEX: Record<PostitColor, string> = {
  yellow: '#ffe45e',
  green: '#8ce99a',
  blue: '#99c9ff',
  pink: '#ffb3d1',
  orange: '#ffb066',
}

/** Post-it persistido no frontmatter (`postits:`). A ancora e semantica — o
 * texto do paragrafo (prefixo normalizado) + ordinal de ocorrencia — para nao
 * depender de offsets absolutos, que o usuario invalida ao editar a nota. */
export type NotePostit = {
  id: string
  /** Prefixo normalizado do texto do paragrafo no momento da criacao. */
  anchorText: string
  /** Qual ocorrencia do mesmo texto ancorar (0 = primeira). */
  anchorOrdinal: number
  color: PostitColor
  text: string
  createdAt: string
  updatedAt: string
}

const ANCHOR_MAX_CHARS = 120

/** Limite de caracteres do texto do post-it: mantem o YAML de frontmatter
 * curto (a nota inteira e reescrita a cada gravacao) e o popover compacto. */
export const POSTIT_MAX_CHARS = 280

/** Zera espacos e normaliza caixa — casamento tolerante a edicao leve. */
function normalizeAnchorText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, ANCHOR_MAX_CHARS)
}

function isValidColor(value: unknown): value is PostitColor {
  return typeof value === 'string' && POSTIT_COLORS.includes(value as PostitColor)
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
}

/** Normaliza um item cru do frontmatter; null o descarta (entrada invalida). */
function coercePostit(value: unknown): NotePostit | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) return null
  if (typeof record.anchorText !== 'string' || !record.anchorText) return null
  if (typeof record.anchorOrdinal !== 'number' || !Number.isInteger(record.anchorOrdinal) || record.anchorOrdinal < 0) return null
  const now = new Date().toISOString()
  return {
    id: record.id,
    anchorText: record.anchorText,
    anchorOrdinal: record.anchorOrdinal,
    color: isValidColor(record.color) ? record.color : 'yellow',
    text: typeof record.text === 'string' ? record.text : '',
    createdAt: isValidTimestamp(record.createdAt) ? record.createdAt : now,
    updatedAt: isValidTimestamp(record.updatedAt) ? record.updatedAt : now,
  }
}

/** Le os post-its do frontmatter da nota. Propriedade ausente ou invalida = []. */
export function getNotePostits(content: string): NotePostit[] {
  const properties = getMarkdownFrontmatterProperties(content)
  const raw = (properties as Record<string, unknown>).postits
  if (!Array.isArray(raw)) return []
  return raw.map(coercePostit).filter((item): item is NotePostit => item !== null)
}

/** Serializa os post-its como source YAML da propriedade `postits` (lista de
 * mapas), para o `setMarkdownFrontmatterPropertySource` gravar preservando o
 * restante do YAML byte a byte. */
function formatPostitsPropertySource(postits: NotePostit[]): string {
  return stringify(postits.map((postit) => ({
    id: postit.id,
    anchorText: postit.anchorText,
    anchorOrdinal: postit.anchorOrdinal,
    color: postit.color,
    text: postit.text,
    createdAt: postit.createdAt,
    updatedAt: postit.updatedAt,
  })))
}

export type PostitMutationResult = {
  content: string
  postits: NotePostit[]
  error: string | null
}

function applyPostitsSource(content: string, source: string, postits: NotePostit[]): PostitMutationResult {
  if (postits.length === 0) {
    // Lista vazia remove a propriedade (nao deixa `postits: []` no YAML).
    const removed = removeMarkdownFrontmatterProperty(content, 'postits')
    return { content: removed.content, postits, error: removed.error }
  }
  const result = setMarkdownFrontmatterPropertySource(content, 'postits', source)
  return { content: result.content, postits, error: result.error }
}

function writePostits(content: string, postits: NotePostit[]): PostitMutationResult {
  const source = postits.length === 0 ? '[]' : formatPostitsPropertySource(postits)
  return applyPostitsSource(content, source, postits)
}

/** Deriva a ancora de um paragrafo no formato que o casamento usa: prefixo
 * normalizado do texto visivel. */
export function deriveAnchorFromParagraph(paragraphText: string): { anchorText: string } {
  return { anchorText: normalizeAnchorText(visibleParagraphText(paragraphText)) }
}

/** Adiciona um post-it ancorado a um paragrafo. O ordinal e a proxima
 * ocorrencia livre do mesmo texto de ancora. */
export function addNotePostit(content: string, input: {
  anchorText: string
  color: PostitColor
  text: string
}): PostitMutationResult {
  const postits = getNotePostits(content)
  const now = new Date().toISOString()
  const anchorOrdinal = postits.filter((postit) => postit.anchorText === input.anchorText).length
  const postit: NotePostit = {
    id: `postit-${now.replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`,
    anchorText: input.anchorText,
    anchorOrdinal,
    color: input.color,
    text: input.text,
    createdAt: now,
    updatedAt: now,
  }
  return writePostits(content, [...postits, postit])
}

/** Atualiza texto/cor de um post-it existente. */
export function updateNotePostit(content: string, id: string, changes: {
  text?: string
  color?: PostitColor
}): PostitMutationResult {
  const postits = getNotePostits(content)
  const index = postits.findIndex((postit) => postit.id === id)
  if (index < 0) return { content, postits, error: 'O post-it não existe mais nesta nota.' }
  const now = new Date().toISOString()
  postits[index] = {
    ...postits[index],
    ...(changes.text !== undefined ? { text: changes.text } : {}),
    ...(changes.color !== undefined ? { color: changes.color } : {}),
    updatedAt: now,
  }
  return writePostits(content, postits)
}

/** Remove um post-it pelo id. */
export function removeNotePostit(content: string, id: string): PostitMutationResult {
  const postits = getNotePostits(content)
  const next = postits.filter((postit) => postit.id !== id)
  if (next.length === postits.length) return { content, postits, error: 'O post-it não existe mais nesta nota.' }
  return writePostits(content, next)
}

/** Paragrafo do corpo com os offsets UTF-16 no markdown COMPLETO (a ancora e
 * calculada sobre o texto visivel, mas o widget precisa da posicao no doc do
 * editor — Misto tem frontmatter, Leitura nao, por isso o offset inicial e
 * parametrizado). */
export type BodyParagraph = {
  text: string
  from: number
  to: number
}

/** Agrupa as linhas contiguas nao vazias do corpo em paragrafos, ignorando o
 * interior de fences de codigo (widget no modo Misto). */
export function findBodyParagraphs(body: string, bodyStartOffset: number): BodyParagraph[] {
  const paragraphs: BodyParagraph[] = []
  const lines = body.split('\n')
  let offset = bodyStartOffset
  let current: { lines: string[]; from: number } | null = null
  let inFence = false
  const flush = (endOffset: number) => {
    if (!current) return
    paragraphs.push({ text: current.lines.join(' '), from: current.from, to: endOffset })
    current = null
  }
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      flush(offset)
      offset += line.length + 1
      continue
    }
    if (inFence) {
      offset += line.length + 1
      continue
    }
    if (line.trim() === '') {
      flush(offset)
      offset += line.length + 1
      continue
    }
    if (!current) current = { lines: [line], from: offset }
    else current.lines.push(line)
    offset += line.length + 1
  }
  flush(offset)
  return paragraphs
}

/** Remove marcadores de markdown do inicio da linha para casar com o texto que
 * o usuario le: `# `, `> `, `- `, `1. `, `1) `, `[ ] `. */
export function visibleParagraphText(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>+\s?/, '')
    .replace(/^(\s*)([-*+])\s+(?:\[[ xX]\]\s+)?/, '$1')
    .replace(/^(\s*)(\d+)([.)])\s+/, '$1')
    .trim()
}

/** Resolve a posicao (inicio do paragrafo) de cada post-it no doc atual.
 * `from` null = orfao (o paragrafo ancorado sumiu ou foi editado alem do
 * casamento tolerante); o post-it permanece salvo e pode ser listado no
 * popover de orfaos. O ordinal distingue paragrafos iguais. */
export type ResolvedPostit = {
  postit: NotePostit
  /** Offset UTF-16 do inicio do paragrafo ancorado, ou null quando orfao. */
  from: number | null
}

export function resolvePostitAnchors(postits: NotePostit[], body: string, bodyStartOffset: number): ResolvedPostit[] {
  const paragraphs = findBodyParagraphs(body, bodyStartOffset)
  return postits.map((postit) => {
    const target = normalizeAnchorText(postit.anchorText)
    if (!target) return { postit, from: null }
    let occurrences = 0
    for (const paragraph of paragraphs) {
      const visible = normalizeAnchorText(visibleParagraphText(paragraph.text))
      if (visible.length > 0 && (visible.startsWith(target) || target.startsWith(visible))) {
        if (occurrences === postit.anchorOrdinal) return { postit, from: paragraph.from }
        occurrences += 1
      }
    }
    return { postit, from: null }
  })
}
