import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { indexDictionary, normalizeTerm, wordAt, type DictionaryEntry } from './dictionarySchema'

/**
 * A extensão que marca as palavras do dicionário e avisa o hover.
 *
 * ## Por que uma extensão do CodeMirror, e não um listener no React
 *
 * Porque os **três** modos (Edição, Misto, Leitura) passam pelo mesmo
 * CodeMirror. Uma extensão pega os três de uma vez; um listener de React
 * sobre o DOM teria que ser escrito duas vezes (uma para o editor, uma para
 * o preview) e ainda assim perderia o texto mascarado pela sintaxe
 * Markdown.
 *
 * ## A marca
 *
 * A marca é um `Decoration.mark` — ela não muda o texto, só a aparência. O
 * usuário continua digitando normalmente, e o texto continua sendo o texto.
 */
export const dictionaryEntriesEffect = StateEffect.define<readonly DictionaryEntry[] | null>()

/**
 * Os verbetes do dicionário, no estado do editor.
 *
 * `null` significa "nenhum verbete". Na prática é o mesmo que uma lista
 * vazia — e a distinção só importa para o relatório.
 */
export const dictionaryEntriesField = StateField.define<readonly DictionaryEntry[] | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(dictionaryEntriesEffect)) {
        return effect.value
      }
    }
    return value
  },
})

/**
 * A marca visual das palavras do dicionário.
 *
 * Deliberadamente **discreta**: um sublinhado pontilhado, e nada mais. A
 * diferenciação visual forte é uma decisão em aberto, e um estilo forte agora
 * é retrabalho depois. O que importa no hover é o conceito — e ele aparece
 * com clareza.
 */
const dictionaryWordMark = Decoration.mark({ class: 'cm-dictionary-word' })

/**
 * Uma palavra do texto, com a posição em que começa.
 */
type Word = { normalized: string; from: number; to: number }

/**
 * As palavras do documento, normalizadas, com as posicoes.
 *
 * A mesma abordagem do filtro determinstico de `improvements.rs`: varre o
 * texto uma vez, guarda cada palavra com a posicao, e compara a versao
 * normalizada. Uma vez por documento, e nao uma vez por termo.
 */
export function documentWords(document: string): Word[] {
  const words: Word[] = []
  let current = ''
  let currentStart = 0
  let offset = 0
  for (const character of document) {
    if (/[\p{L}\p{N}]/u.test(character)) {
      if (!current) currentStart = offset
      current += character
    } else if (current) {
      words.push({ normalized: normalizeTerm(current), from: currentStart, to: offset })
      current = ''
    }
    offset += character.length
  }
  if (current) {
    words.push({ normalized: normalizeTerm(current), from: currentStart, to: offset })
  }
  return words.filter((word) => word.normalized.length > 0)
}

/**
 * As posicoes onde cada termo do dicionario aparece.
 *
 * ## O casamento e por palavra inteira
 *
 * O termo "arte" nao pode casar com "partido", e o termo "os" nao pode
 * marcar "os" dentro de "osso". Por isso a comparacao e entre palavras
 * inteiras, e nao entre substrings do texto.
 *
 * ## Termo de varias palavras
 *
 * "glicolise aerobica" casa a sequencia de duas palavras adjacentes, com
 * qualquer espacamento entre elas. E as palavras sao comparadas uma a uma,
 * o que faz o casamento ignorar acentos e caixa sem construo o texto
 * inteiro de novo a cada termo.
 */
export function termPositions(
  words: readonly Word[],
  term: string,
): Array<{ from: number; to: number }> {
  const wanted = term
    .split(/\s+/)
    .map((word) => normalizeTerm(word))
    .filter((word) => word.length > 0)
  if (wanted.length === 0) return []

  const positions: Array<{ from: number; to: number }> = []
  for (let index = 0; index + wanted.length <= words.length; index += 1) {
    let matches = true
    for (let offset = 0; offset < wanted.length; offset += 1) {
      if (words[index + offset].normalized !== wanted[offset]) {
        matches = false
        break
      }
    }
    if (!matches) continue
    positions.push({
      from: words[index].from,
      to: words[index + wanted.length - 1].to,
    })
  }
  return positions
}

/**
 * As decorações das palavras do dicionario.
 */
function dictionaryDecorations(
  state: EditorState,
  entries: readonly DictionaryEntry[] | null,
): DecorationSet {
  if (!entries || entries.length === 0) return Decoration.none
  const index = indexDictionary(entries)
  if (index.size === 0) return Decoration.none

  const words = documentWords(state.doc.toString())
  if (words.length === 0) return Decoration.none

  const ranges: Array<{ from: number; to: number }> = []
  // Os termos mais longos primeiro: assim "glicolise aerobica" ganha de
  // "glicolise" quando as duas palavras aparecem na mesma frase.
  const terms = [...index.keys()].sort((left, right) => right.length - left.length)
  for (const term of terms) {
    ranges.push(...termPositions(words, term))
  }

  // Um termo que contem outro marcaria a mesma faixa duas vezes, e o
  // CodeMirror nao aceita faixas sobrepostas.
  ranges.sort((left, right) => left.from - right.from || right.to - left.to)
  const marks: ReturnType<DecorationSet['of']>[] = []
  let lastTo = -1
  for (const range of ranges) {
    if (range.from < lastTo) continue
    marks.push(dictionaryWordMark.range(range.from, range.to))
    lastTo = range.to
  }
  return Decoration.set(marks, true)
}

/**
 * O campo que guarda as decorações das palavras do dicionário.
 */
/**
 * O valor atual do campo de verbetes.
 *
 * `StateField.init` devolve os **slots** do campo, nao o valor — o valor
 * vive em `state.field(field)`. Chamar `init` e usar como se fosse o valor
 * da um array de slots, e cada slot parece um verbete: um bug que so
 * apareceria com um dicionario nao vazio.
 */
function currentEntries(state: EditorState): readonly DictionaryEntry[] | null {
  return state.field(dictionaryEntriesField) ?? null
}

const dictionaryDecorationField = StateField.define<DecorationSet>({
  create: (state) => dictionaryDecorations(state, currentEntries(state)),
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(dictionaryEntriesEffect)) {
        return dictionaryDecorations(transaction.state, effect.value)
      }
    }
    if (transaction.docChanged) {
      return dictionaryDecorations(transaction.state, currentEntries(transaction.state))
    }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * O que o editor avisa quando o hover encontra (ou deixa de encontrar) uma
 * palavra do dicionário.
 */
export type DictionaryHoverHandler = (entry: DictionaryEntry | null) => void

/**
 * O verbete do dicionário sob uma posição do documento.
 *
 * `null` quando a posição não está numa palavra, ou quando a palavra não
 * tem conceito registrado.
 */
export function dictionaryEntryAt(
  state: EditorState,
  position: number,
): DictionaryEntry | null {
  const entries = currentEntries(state)
  if (!entries || entries.length === 0) return null

  const line = state.doc.lineAt(position)
  const text = line.text
  const offset = position - line.from

  // `wordAt` exige que a posicao esteja DENTRO da palavra: sobre um espaco,
  // ele devolve `null` em vez da palavra vizinha.
  const found = wordAt(text, offset)
  if (!found) return null

  const key = normalizeTerm(found.word)
  if (!key) return null
  return indexDictionary(entries).get(key) ?? null
}

/**
 * A extensão do dicionário.
 *
 * `hoverHandler` recebe o verbete encontrado, ou `null` quando a palavra não
 * tem conceito. O `hoverRect` recebe o retângulo da palavra, para o tooltip
 * ser posicionado **acima** dela.
 */
export function dictionaryExtension(options: {
  hoverHandler?: DictionaryHoverHandler
  hoverRect?: (rect: DOMRect | null) => void
} = {}): Extension {
  return [
    dictionaryEntriesField,
    dictionaryDecorationField,
    EditorView.domEventHandlers({
      mousemove(event, view) {
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (position === null) {
          options.hoverHandler?.(null)
          options.hoverRect?.(null)
          return false
        }
        const entry = dictionaryEntryAt(view.state, position)
        if (!entry) {
          options.hoverHandler?.(null)
          options.hoverRect?.(null)
          return false
        }
        const coords = view.coordsAtPos(position)
        options.hoverHandler?.(entry)
        options.hoverRect?.(
          coords
            ? new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top)
            : null,
        )
        return false
      },
      mouseleave() {
        options.hoverHandler?.(null)
        options.hoverRect?.(null)
        return false
      },
    }),
  ]
}
