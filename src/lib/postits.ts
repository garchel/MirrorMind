import { stringify } from 'yaml'
import {
  getMarkdownFrontmatterProperties,
  removeMarkdownFrontmatterProperty,
  setMarkdownFrontmatterPropertySource,
} from './markdown'

/** Cores validas do post-it — as mesmas sete pastilhas do marca-texto. */
export type PostitColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | 'purple' | 'red'

/** Rotulos das cores no popover (tooltip, aria-label e hint da cor ativa). */
export const POSTIT_COLOR_LABELS: Record<PostitColor, string> = {
  yellow: 'Amarelo',
  green: 'Verde',
  blue: 'Azul',
  pink: 'Rosa',
  orange: 'Laranja',
  purple: 'Roxo',
  red: 'Vermelho',
}

export const POSTIT_COLORS: PostitColor[] = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple', 'red']

export const POSTIT_COLOR_HEX: Record<PostitColor, string> = {
  yellow: '#ffe45e',
  green: '#8ce99a',
  blue: '#99c9ff',
  pink: '#ffb3d1',
  orange: '#ffb066',
  purple: '#c7a3f2',
  red: '#f19191',
}

/** Ancora por citacao (frase exata do post-it): o texto selecionado +
 * contexto para desambiguar + ocorrencia. Offsets nunca sao persistidos
 * (apodrecem na primeira edicao); a resolucao recalcula a cada render. */
export type PostitRangeAnchor = {
  /** Trecho selecionado (ate QUOTE_MAX_CHARS). */
  quote: string
  /** Ate RANGE_CONTEXT_CHARS antes da citacao. */
  prefix: string
  /** Ate RANGE_CONTEXT_CHARS depois da citacao. */
  suffix: string
  /** Qual ocorrencia da citacao ancorar (indice entre as candidatas com o
   * mesmo contexto; 0 = primeira). */
  occurrence: number
}

/** Post-it persistido no frontmatter (`postits:`). A ancora e semantica — o
 * texto do paragrafo (prefixo normalizado) + ordinal de ocorrencia — para nao
 * depender de offsets absolutos, que o usuario invalida ao editar a nota.
 * `range` (opcional) ancora a FRASE exata: quando resolve, a faixa vira marca
 * com borda no editor (sem pino); quando nao resolve, cai para o paragrafo. */
export type NotePostit = {
  id: string
  /** Prefixo normalizado do texto do paragrafo no momento da criacao. */
  anchorText: string
  /** Qual ocorrencia do mesmo texto ancorar (0 = primeira). */
  anchorOrdinal: number
  /** Ancora de frase; null = post-it de paragrafo (pino, legado). */
  range: PostitRangeAnchor | null
  color: PostitColor
  text: string
  createdAt: string
  updatedAt: string
}

const ANCHOR_MAX_CHARS = 120

/** Limites da ancora de frase: citacao exata (acima disso a criacao e
 * bloqueada com aviso) + contexto de desambiguacao de cada lado. */
export const POSTIT_QUOTE_MAX_CHARS = 500
export const POSTIT_RANGE_CONTEXT_CHARS = 64

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

/** Normaliza um item cru do frontmatter; null o descarta (entrada invalida).
 * `range` ausente ou invalido degrada para post-it de paragrafo (pino). */
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
    range: coercePostitRange(record.range),
    color: isValidColor(record.color) ? record.color : 'yellow',
    text: typeof record.text === 'string' ? record.text : '',
    createdAt: isValidTimestamp(record.createdAt) ? record.createdAt : now,
    updatedAt: isValidTimestamp(record.updatedAt) ? record.updatedAt : now,
  }
}

/** Normaliza a ancora de frase; null quando ausente ou invalida (o post-it
 * continua valido como post-it de paragrafo). */
function coercePostitRange(value: unknown): PostitRangeAnchor | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.quote !== 'string' || !record.quote.trim()) return null
  if (typeof record.occurrence !== 'number' || !Number.isInteger(record.occurrence) || record.occurrence < 0) return null
  return {
    quote: record.quote,
    prefix: typeof record.prefix === 'string' ? record.prefix : '',
    suffix: typeof record.suffix === 'string' ? record.suffix : '',
    occurrence: record.occurrence,
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
    // So serializa a ancora de frase quando existe (YAMLs antigos inalterados).
    ...(postit.range ? { range: postit.range } : {}),
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
  range?: PostitRangeAnchor | null
}): PostitMutationResult {
  const postits = getNotePostits(content)
  const now = new Date().toISOString()
  const anchorOrdinal = postits.filter((postit) => postit.anchorText === input.anchorText).length
  const postit: NotePostit = {
    id: `postit-${now.replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`,
    anchorText: input.anchorText,
    anchorOrdinal,
    range: input.range ?? null,
    color: input.color,
    text: input.text,
    createdAt: now,
    updatedAt: now,
  }
  return writePostits(content, [...postits, postit])
}

/** Atualiza texto/cor/area de um post-it existente (`range` ausente = mantem;
 * `range: null` = volta a paragrafo). */
export function updateNotePostit(content: string, id: string, changes: {
  text?: string
  color?: PostitColor
  range?: PostitRangeAnchor | null
}): PostitMutationResult {
  const postits = getNotePostits(content)
  const index = postits.findIndex((postit) => postit.id === id)
  if (index < 0) return { content, postits, error: 'O post-it não existe mais nesta nota.' }
  const now = new Date().toISOString()
  postits[index] = {
    ...postits[index],
    ...(changes.text !== undefined ? { text: changes.text } : {}),
    ...(changes.color !== undefined ? { color: changes.color } : {}),
    ...(changes.range !== undefined ? { range: changes.range } : {}),
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
  /** Faixa da frase ancorada (offsets no corpo), ou null quando o post-it e
   * de paragrafo ou a citacao nao resolveu (cai para o paragrafo/pino). */
  range: { from: number; to: number } | null
}

export function resolvePostitAnchors(postits: NotePostit[], body: string, bodyStartOffset: number): ResolvedPostit[] {
  const paragraphs = findBodyParagraphs(body, bodyStartOffset)
  // Strip uma vez por lote (o corpo de 200KB domina o custo por post-it).
  const { text: visible, map } = stripInlineHtmlForMatch(body)
  return postits.map((postit) => {
    const target = normalizeAnchorText(postit.anchorText)
    if (!target) return { postit, from: null, range: null }
    let occurrences = 0
    let paragraphFrom: number | null = null
    for (const paragraph of paragraphs) {
      const visible = normalizeAnchorText(visibleParagraphText(paragraph.text))
      if (visible.length > 0 && (visible.startsWith(target) || target.startsWith(visible))) {
        if (occurrences === postit.anchorOrdinal) {
          paragraphFrom = paragraph.from
          break
        }
        occurrences += 1
      }
    }
    // Faixa da frase quando existe (offsets no corpo, sem bodyStartOffset —
    // o chamador soma como faz com `from`); sem citacao resolvida, o pino do
    // paragrafo assume (retrocompat total).
    const range = postit.range ? resolveQuoteInVisible(postit.range, visible, map, body.length) : null
    if (paragraphFrom === null && range === null) return { postit, from: null, range: null }
    return { postit, from: paragraphFrom, range }
  })
}

/** Colapsa espacos (tolerante a quebra de linha/soft-wrap) para comparar
 * citacao e contexto sem depender da formatacao exata. */
function normalizeRangeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Tags inline que envolvem texto visivel (marca-texto, kbd, formato...):
 * ignoradas no casamento da citacao — o `formatMarkdownSelection` e o
 * live preview mascaram essas tags, entao a frase que o usuario seleciona
 * nao as contem, mas o corpo cru sim. `<br>` vira espaco. */
const POSTIT_INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'sup', 'time', 'u', 'var', 'wbr',
])

const POSTIT_TAG_PATTERN = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^<>]*>|<br\s*\/?>/gi

/** Texto visivel do corpo (sem tags inline) + mapa offset visivel -> offset
 * original. `<` sem fechar tag (ex.: "a < b") e preservado literal. */
export function stripInlineHtmlForMatch(body: string): { text: string; map: number[] } {
  const parts: string[] = []
  const map: number[] = []
  let cursor = 0
  POSTIT_TAG_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = POSTIT_TAG_PATTERN.exec(body)) !== null) {
    const tagName = (match[2] ?? '').toLowerCase()
    const isBreak = match[0].toLowerCase().startsWith('<br')
    if (!isBreak && !POSTIT_INLINE_TAGS.has(tagName)) continue
    for (let i = cursor; i < match.index; i++) {
      parts.push(body[i])
      map.push(i)
    }
    if (isBreak) {
      parts.push(' ')
      map.push(match.index)
    }
    cursor = match.index + match[0].length
  }
  for (let i = cursor; i < body.length; i++) {
    parts.push(body[i])
    map.push(i)
  }
  return { text: parts.join(''), map }
}

/** Padrao exato da citacao com espacos flexiveis: casa "mesma   frase" em
 * "mesma frase" (e vice-versa) mantendo os offsets verdadeiros do corpo. */
function buildQuotePattern(quote: string): RegExp | null {
  const normalized = normalizeRangeText(quote)
  if (!normalized) return null
  return new RegExp(escapeRegExp(normalized).replace(/ /g, '\\s+'), 'g')
}

/** Todas as ocorrencias da citacao no corpo (offsets verdadeiros). */
function findQuoteMatches(body: string, quote: string): Array<{ from: number; to: number }> {
  const pattern = buildQuotePattern(quote)
  if (!pattern) return []
  const matches: Array<{ from: number; to: number }> = []
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    if (match[0].length === 0) {
      pattern.lastIndex += 1
      continue
    }
    matches.push({ from: match.index, to: match.index + match[0].length })
  }
  return matches
}

/** Confere prefixo/sufixo ao redor de um casamento (janela com folga para a
 * normalizacao nao quebrar a borda). */
function quoteMatchFitsContext(body: string, match: { from: number; to: number }, prefix: string, suffix: string): boolean {
  const beforeOk = !prefix || normalizeRangeText(body.slice(Math.max(0, match.from - prefix.length - 16), match.from)).endsWith(prefix)
  const afterOk = !suffix || normalizeRangeText(body.slice(match.to, match.to + suffix.length + 16)).startsWith(suffix)
  return beforeOk && afterOk
}

/** Candidatas a resolucao: as que passam no contexto; se nenhuma passar, todas
 * (citacao deslocada mas reconhecivel — tolerante em vez de orfao). */
function contextualQuoteMatches(body: string, quote: string, prefix: string, suffix: string): Array<{ from: number; to: number }> {
  const matches = findQuoteMatches(body, quote)
  const fitting = matches.filter((match) => quoteMatchFitsContext(body, match, prefix, suffix))
  return fitting.length > 0 ? fitting : matches
}

/** Deriva a ancora de frase de uma selecao do corpo (offsets crus). A selecao
 * e convertida para texto visivel (sem tags inline): a citacao salva nunca
 * carrega `<mark>` etc., e `occurrence` e o indice entre as candidatas com o
 * mesmo contexto (desempate deterministico, mesma lista que a resolucao
 * usa). null quando a selecao cobre so tags, e vazia ou estoura o limite
 * (a criacao bloqueia com aviso em vez de gravar area errada). */
export function deriveRangeAnchorFromSelection(body: string, from: number, to: number): PostitRangeAnchor | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > body.length || from >= to) return null
  const { text: visible, map } = stripInlineHtmlForMatch(body)
  const visibleFrom = countVisibleBefore(map, from)
  const visibleTo = countVisibleBefore(map, to)
  if (visibleFrom >= visibleTo) return null
  // Aparada: arrastos costumam incluir espaco da borda; a faixa resolvida
  // exclui, e o casamento continua exato.
  const quote = visible.slice(visibleFrom, visibleTo).trim()
  if (normalizeRangeText(quote).length === 0 || quote.length > POSTIT_QUOTE_MAX_CHARS) return null
  const prefix = normalizeRangeText(visible.slice(Math.max(0, visibleFrom - POSTIT_RANGE_CONTEXT_CHARS), visibleFrom)).slice(-POSTIT_RANGE_CONTEXT_CHARS)
  const suffix = normalizeRangeText(visible.slice(visibleTo, visibleTo + POSTIT_RANGE_CONTEXT_CHARS)).slice(0, POSTIT_RANGE_CONTEXT_CHARS)
  const occurrence = contextualQuoteMatches(visible, quote, prefix, suffix).findIndex((match) => match.from === visibleFrom)
  if (occurrence < 0) return null
  return { quote, prefix, suffix, occurrence }
}

/** Resolve a citacao para offsets VERDADEIROS no corpo. O casamento roda no
 * texto visivel (sem tags inline — marca-texto etc. nao quebram a citacao)
 * e o mapa devolve os offsets crus para o editor. Exato (case-sensitive)
 * com espacos flexiveis; `prefix`/`suffix` desempatam repetidas;
 * `occurrence` escolhe entre as candidatas (fora da faixa = null, cai para
 * o paragrafo). Citacoes antigas com tags cruas sao normalizadas antes
 * (migracao silenciosa). */
export function resolvePostitRange(range: PostitRangeAnchor, body: string): { from: number; to: number } | null {
  const { text: visible, map } = stripInlineHtmlForMatch(body)
  return resolveQuoteInVisible(range, visible, map, body.length)
}

/** Nucleo da resolucao sobre texto visivel + mapa (o strip roda uma vez por
 * lote, nao uma vez por post-it). */
function resolveQuoteInVisible(
  range: PostitRangeAnchor,
  visible: string,
  map: number[],
  bodyLength: number,
): { from: number; to: number } | null {
  const strippedQuote = stripInlineHtmlForMatch(range.quote).text
  const quote = normalizeRangeText(strippedQuote) ? strippedQuote : range.quote
  const candidates = contextualQuoteMatches(visible, quote, normalizeRangeText(range.prefix), normalizeRangeText(range.suffix))
  if (candidates.length === 0 || range.occurrence < 0 || range.occurrence >= candidates.length) return null
  const match = candidates[range.occurrence]
  return { from: map[match.from], to: match.to < visible.length ? map[match.to] : bodyLength }
}

/** Quantos caracteres visiveis existem antes do offset original. */
function countVisibleBefore(map: number[], rawOffset: number): number {
  let count = 0
  for (const original of map) {
    if (original >= rawOffset) break
    count += 1
  }
  return count
}

/** Sobreposicao de faixas (tocar na borda NAO e sobrepor: frases coladas sao
 * permitidas). Usado para bloquear criacao/re-ancoragem sobre outro post-it. */
export function postitRangesOverlap(first: { from: number; to: number }, second: { from: number; to: number }): boolean {
  return first.from < second.to && second.from < first.to
}
