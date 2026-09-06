import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { ForwardedRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { styleTags, tags as highlightTags } from '@lezer/highlight'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap } from '@codemirror/view'
import { markdownLivePreview, postitDataEffect, registerPostitClickHandler, reviewGapDataEffect, type LinkTarget, type PostitData, type ReviewGapData } from './markdownLivePreview'
import { getMarkdownAutocompleteResult, type MarkdownAutocompleteData } from '../lib/markdown-autocomplete'
import { findTextMatches } from '../lib/findMatches'

export type MarkdownEditorSession = {
  selectionStart: number
  selectionEnd: number
  scrollTop: number
}

export type MarkdownEditorHistoryStatus = {
  canRedo: boolean
  canUndo: boolean
}


export type MarkdownCodeEditorHandle = {
  getSelection: () => { value: string; selectionStart: number; selectionEnd: number } | null
  /** Retangulo (em coordenadas de viewport) da linha do cursor inicial da
   * selecao, ou null quando a selecao esta colapsada ou fora da area visivel.
   * Usado pelo popover de formatacao para posicionar-se junto ao texto. */
  getSelectionRect: () => { bottom: number; left: number; right: number; top: number } | null
  focus: () => void
  redo: () => boolean
  selectRange: (from: number, to: number) => void
  setFindQuery: (query: string) => void
  undo: () => boolean
  /** Offset do inicio do paragrafo que contem `from` (ou null). Usado pelo
   * post-it para ancorar na linha onde esta o cursor. */
  getParagraphStartAt: (from: number) => number | null
  /** Texto visivel do paragrafo que contem `from` (ou null). */
  getParagraphTextAt: (from: number) => string | null
  /** Retangulo (viewport) de uma posicao qualquer do doc, ou null fora do
   * visivel. Usado para posicionar o popover de post-it sobre o pino. */
  getRectAt: (from: number) => { bottom: number; left: number; right: number; top: number } | null
}

type MarkdownCodeEditorProps = {
  ariaLabel?: string
  autoFocus?: boolean
  documentKey: string
  livePreview?: boolean
  /** Limite do historico de desfazer/refazer (CodeMirror `history.minDepth`). */
  historyLimit?: number
  onBlur?: () => void
  onChange: (value: string) => void
  onHistoryChange: (status: MarkdownEditorHistoryStatus) => void
  /** Navegacao de links no modo Misto (widget clicavel quando mascara ativa). */
  onOpenLink?: (target: LinkTarget) => void
  onSearchRequest?: () => void
  onSessionChange: (session: MarkdownEditorSession) => void
  /** Modo leitura (spike do motor unico): bloqueia edicao, caret e revelacao. */
  readOnly?: boolean
  /** Resolve um ativo do vault (caminho relativo) para URL utilizavel
   * (imagens do modo Misto; convertFileSrc no app). */
  resolveAssetUrl?: (relativePath: string) => string | undefined
  /** Le o corpo (sem frontmatter) de uma nota incorporada `![[nota]]` no modo
   * Misto (embeds de nota). Sem ele, os embeds nao sao renderizados. */
  getEmbedContent?: (relativePath: string) => Promise<string>
  /** Caminho do vault, necessario para os embeds de PDF no modo Misto. */
  vaultPath?: string
  /** Lacunas da última revisão (gap marks do modo Leitura) no motor único.
   * Muda assincronamente após o fetch; o componente dispara
   * `reviewGapDataEffect` para atualizar as decorações sem recriar o editor. */
  reviewGapData?: ReviewGapData | null
  /** Post-its (pinos na margem esquerda). Muda quando o frontmatter do draft
   * muda; o componente dispara `postitDataEffect` sem recriar o editor. */
  postitData?: PostitData | null
  /** Clique em um pino de post-it (widget CM nao tem acesso a props React). */
  onPostitClick?: (id: string) => void
  /** Quebra de linha automatica (EditorView.lineWrapping). Padrao: true;
   * o modo Leitura read-only respeita a preferência `reading-line-wrap`. */
  lineWrap?: boolean
  session?: MarkdownEditorSession
  spellCheck?: boolean
  stateCache?: Map<string, EditorState>
  autocompleteData?: MarkdownAutocompleteData
  value: string
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: '#252521',
    fontFamily: 'var(--mono)',
    fontSize: '15px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
    lineHeight: '1.75',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '28px max(40px, 7vw)',
    caretColor: '#5d7664',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: '#dce6dc !important',
  },
  '&.cm-focused': {
    outline: '2px solid #9cafa0',
    outlineOffset: '-2px',
  },
  '.cm-find-match': {
    backgroundColor: 'rgba(255, 213, 79, 0.4)',
    borderRadius: '2px',
  },
  '.cm-find-match-selected': {
    backgroundColor: 'rgba(255, 138, 0, 0.55)',
  },
})

/**
 * Bug do setext + negrito: um parágrafo terminado em **negrito** seguido de
 * `---` é SetextHeading2 no Lezer — o syntax highlighter aplica heading2
 * (bold + underline) ao PARAGRAFO INTEIRO, mesmo com o live preview
 * renderizando `---` como divisor. Remapeia o ESTILO dos nós setext para
 * `content`: a árvore sintática continua idêntica (o live preview, que
 * decide o que mascara, lê a árvore — não os estilos), mas o highlighting
 * deixa de engrossar a linha. O sublinhado `===` real (SetextHeading1 com
 * underline válido) também perde o estilo de heading na Edição, mas o
 * live preview continua o tratando como heading visual no Misto — o custo
 * é só o destaque do modo Edição crua.
 */
const setextAsContentExtension = {
  props: [
    styleTags({
      'SetextHeading1/...': highlightTags.content,
      'SetextHeading2/...': highlightTags.content,
    }),
  ],
}

function continueMarkdownBlock(view: EditorView) {
  const selection = view.state.selection.main
  if (!selection.empty) return false
  const line = view.state.doc.lineAt(selection.head)
  const beforeCursor = line.text.slice(0, selection.head - line.from)
  const match = beforeCursor.match(/^(\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?))(.*)$/)
  if (!match) return false

  const [, marker, text] = match
  if (!text.trim()) {
    view.dispatch({ changes: { from: line.from, to: selection.head, insert: '' } })
    return true
  }

  const ordered = marker.match(/^(\s*)(\d+)([.)]\s+)/)
  const nextMarker = ordered
    ? `${ordered[1]}${Number(ordered[2]) + 1}${ordered[3]}`
    : marker
  view.dispatch({
    changes: { from: selection.head, insert: `\n${nextMarker}` },
    selection: { anchor: selection.head + nextMarker.length + 1 },
    userEvent: 'input',
  })
  return true
}

function moveMarkdownTableCell(view: EditorView, backwards = false) {
  const selection = view.state.selection.main
  if (!selection.empty) return false
  const line = view.state.doc.lineAt(selection.head)
  const pipes = [...line.text.matchAll(/\|/g)].map((match) => line.from + (match.index ?? 0))
  if (pipes.length < 2) return false
  const nextPipe = backwards
    ? [...pipes].reverse().find((position) => position < selection.head)
    : pipes.find((position) => position > selection.head)
  if (nextPipe !== undefined) {
    view.dispatch({ selection: { anchor: Math.min(nextPipe + 2, line.to) } })
    return true
  }
  if (backwards) return false

  const nextLine = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : null
  if (nextLine?.text.includes('|')) {
    view.dispatch({ selection: { anchor: nextLine.from + 2 } })
    return true
  }
  const cellCount = pipes.length - 1
  const newRow = `\n|${'  |'.repeat(cellCount)}`
  view.dispatch({
    changes: { from: line.to, insert: newRow },
    selection: { anchor: line.to + 3 },
    userEvent: 'input',
  })
  return true
}

function applyInlineMarkdown(view: EditorView, before: string, after: string) {
  const selection = view.state.selection.main
  const selected = view.state.sliceDoc(selection.from, selection.to)
  const isWrapped = selected.startsWith(before) && selected.endsWith(after)
  const replacement = isWrapped
    ? selected.slice(before.length, selected.length - after.length)
    : `${before}${selected || 'texto'}${after}`
  const selectedLength = isWrapped ? replacement.length : Math.max(0, replacement.length - before.length - after.length)
  const selectionStart = selection.from + (isWrapped ? 0 : before.length)
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: replacement },
    selection: { anchor: selectionStart, head: selectionStart + selectedLength },
    userEvent: 'input',
  })
  return true
}

function applyMarkdownList(view: EditorView, type: 'bullet' | 'ordered' | 'checklist') {
  const selection = view.state.selection.main
  const startLine = view.state.doc.lineAt(selection.from)
  const endLine = view.state.doc.lineAt(selection.to)
  const lines = Array.from({ length: endLine.number - startLine.number + 1 }, (_, index) => view.state.doc.line(startLine.number + index).text)
  const marker = type === 'bullet' ? '- ' : type === 'ordered' ? '1. ' : '- [ ] '
  const existingPattern = type === 'bullet'
    ? /^(\s*)[-*+]\s+/
    : type === 'ordered'
      ? /^(\s*)\d+[.)]\s+/
      : /^(\s*)[-*+]\s+\[[ xX]\]\s+/
  const shouldRemove = lines.every((line) => existingPattern.test(line))
  const replacement = lines.map((line, index) => {
    if (shouldRemove) return line.replace(existingPattern, '$1')
    const indent = line.match(/^\s*/)?.[0] ?? ''
    const orderedMarker = type === 'ordered' ? `${index + 1}. ` : marker
    return `${indent}${orderedMarker}${line.slice(indent.length)}`
  }).join('\n')
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert: replacement },
    selection: { anchor: startLine.from, head: startLine.from + replacement.length },
    userEvent: 'input',
  })
  return true
}

function contextualCompletions(context: CompletionContext, data: MarkdownAutocompleteData) {
  return getMarkdownAutocompleteResult(context.state.doc.toString(), context.pos, data)
}

const findQueryEffect = StateEffect.define<string>()
const findQueryField = StateField.define<string>({
  create: () => '',
  update(query, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(findQueryEffect)) return effect.value
    }
    return query
  },
})

const findMatchMark = Decoration.mark({ class: 'cm-find-match' })
const findSelectedMatchMark = Decoration.mark({ class: 'cm-find-match cm-find-match-selected' })

const findHighlighter = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    const query = transaction.state.field(findQueryField)
    const queryChanged = transaction.effects.some((effect) => effect.is(findQueryEffect))
    const selectionChanged = transaction.selection !== undefined
    if (!queryChanged && !transaction.docChanged && !selectionChanged) {
      return decorations
    }
    if (!query) return Decoration.none
    const text = transaction.state.doc.toString()
    const matches = findTextMatches(text, query)
    if (matches.length === 0) return Decoration.none
    const { from: selectedFrom, to: selectedTo } = transaction.state.selection.main
    const builder = new RangeSetBuilder<Decoration>()
    for (const match of matches) {
      const selected = match.from === selectedFrom && match.to === selectedTo
      builder.add(match.from, match.to, selected ? findSelectedMatchMark : findMatchMark)
    }
    return builder.finish()
  },
  provide: (field) => EditorView.decorations.from(field),
})

function MarkdownCodeEditorComponent(
  { ariaLabel = 'Editor Markdown', autoFocus = false, autocompleteData = { attachments: [], notePaths: [], tags: [] }, documentKey, getEmbedContent, historyLimit = 100, lineWrap = true, livePreview = false, onBlur, onChange, onHistoryChange, onOpenLink, onPostitClick, onSearchRequest, onSessionChange, readOnly = false, resolveAssetUrl, reviewGapData, postitData, session, spellCheck = true, stateCache, value, vaultPath }: MarkdownCodeEditorProps,
  ref: ForwardedRef<MarkdownCodeEditorHandle>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const statesByDocumentRef = useRef(stateCache ?? new Map<string, EditorState>())
  if (stateCache) statesByDocumentRef.current = stateCache
  const activeDocumentKeyRef = useRef(documentKey)
  const initialDocumentKeyRef = useRef(documentKey)
  const initialSessionRef = useRef(session)
  const initialValueRef = useRef(value)
  const autoFocusRef = useRef(autoFocus)
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const onHistoryChangeRef = useRef(onHistoryChange)
  const onSearchRequestRef = useRef(onSearchRequest)
  const onSessionChangeRef = useRef(onSessionChange)
  const autocompleteDataRef = useRef(autocompleteData)
  const spellCheckRef = useRef(spellCheck)
  const ariaLabelRef = useRef(ariaLabel)
  const livePreviewRef = useRef(livePreview)
  const lineWrapRef = useRef(lineWrap)
  const onOpenLinkRef = useRef(onOpenLink)
  const readOnlyRef = useRef(readOnly)
  const resolveAssetUrlRef = useRef(resolveAssetUrl)
  const getEmbedContentRef = useRef(getEmbedContent)
  const vaultPathRef = useRef(vaultPath)
  const reviewGapDataRef = useRef(reviewGapData)
  const postitDataRef = useRef(postitData)
  const onPostitClickRef = useRef(onPostitClick)

  getEmbedContentRef.current = getEmbedContent
  vaultPathRef.current = vaultPath
  reviewGapDataRef.current = reviewGapData
  postitDataRef.current = postitData
  onPostitClickRef.current = onPostitClick

  onChangeRef.current = onChange
  onBlurRef.current = onBlur
  onHistoryChangeRef.current = onHistoryChange
  onSearchRequestRef.current = onSearchRequest
  onSessionChangeRef.current = onSessionChange
  autocompleteDataRef.current = autocompleteData
  spellCheckRef.current = spellCheck
  ariaLabelRef.current = ariaLabel
  livePreviewRef.current = livePreview
  lineWrapRef.current = lineWrap
  onOpenLinkRef.current = onOpenLink
  readOnlyRef.current = readOnly
  resolveAssetUrlRef.current = resolveAssetUrl

  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute('spellcheck', String(spellCheck))
  }, [spellCheck])

  // Lacunas da revisao chegam assincronamente (fetch); dispara o efeito para
  // o campo de gap marks atualizar as decoracoes sem recriar o editor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: reviewGapDataEffect.of(reviewGapData ?? null) })
  }, [reviewGapData])

  // Post-its mudam com o frontmatter do draft (criacao/edicao/remocao);
  // dispara o efeito para o campo de pinos atualizar sem recriar o editor.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: postitDataEffect.of(postitData ?? null) })
  }, [postitData])

  // Widgets CM nao tem acesso a props React: o handler de clique dos pinos e
  // registrado no modulo do live preview (chave '*' captura qualquer pino).
  useEffect(() => registerPostitClickHandler('*', (id) => onPostitClickRef.current?.(id)), [])

  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute('aria-label', ariaLabel)
  }, [ariaLabel])

  function reportHistoryStatus(state: EditorState) {
    onHistoryChangeRef.current({
      canRedo: redoDepth(state) > 0,
      canUndo: undoDepth(state) > 0,
    })
  }

  const createEditorState = useCallback((document: string, editorSession?: MarkdownEditorSession) => {
    return EditorState.create({
      doc: document,
      selection: {
        anchor: Math.min(editorSession?.selectionStart ?? 0, document.length),
        head: Math.min(editorSession?.selectionEnd ?? editorSession?.selectionStart ?? 0, document.length),
      },
      extensions: [
        history({ minDepth: historyLimit }),
        // GFM como base: tabelas, tarefas, riscado e links de autolink ganham
        // nos na arvore sintatica, a mesma base do modo Leitura (remark-gfm).
        // A extensao setext desativa o ESTILO de heading (bold) que o
        // highlighter aplica ao paragrafo inteiro acima de um divisor `---`.
        markdown({ base: markdownLanguage, codeLanguages: languages, extensions: setextAsContentExtension }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        search({ top: true }),
        findQueryField,
        findHighlighter,
        ...(readOnlyRef.current
          ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
          : []),
        autocompletion({
          activateOnTyping: true,
          override: [(context) => contextualCompletions(context, autocompleteDataRef.current)],
        }),
        ...(livePreviewRef.current
          ? markdownLivePreview({
            getOpenLink: () => onOpenLinkRef.current,
            getAssetUrl: (relativePath) => resolveAssetUrlRef.current?.(relativePath),
            getEmbedContent: (relativePath) => getEmbedContentRef.current?.(relativePath) ?? Promise.resolve(''),
            vaultPath: vaultPathRef.current,
            getReviewGapData: () => reviewGapDataRef.current ?? null,
            getPostitData: () => postitDataRef.current ?? null,
          })
          : []),
        ...(lineWrapRef.current ? [EditorView.lineWrapping] : []),
        EditorView.contentAttributes.of({
          'aria-label': ariaLabelRef.current,
          spellcheck: String(spellCheckRef.current),
        }),
        EditorView.domEventHandlers({
          blur: () => {
            onBlurRef.current?.()
            return false
          },
        }),
        keymap.of([
          { key: 'Enter', run: continueMarkdownBlock },
          { key: 'Tab', run: (view) => moveMarkdownTableCell(view) || indentMore(view) },
          { key: 'Shift-Tab', run: (view) => moveMarkdownTableCell(view, true) || indentLess(view) },
          { key: 'Mod-b', run: (view) => applyInlineMarkdown(view, '**', '**') },
          { key: 'Mod-i', run: (view) => applyInlineMarkdown(view, '_', '_') },
          { key: 'Mod-Shift-8', run: (view) => applyMarkdownList(view, 'bullet') },
          { key: 'Mod-Shift-7', run: (view) => applyMarkdownList(view, 'ordered') },
          { key: 'Mod-Shift-9', run: (view) => applyMarkdownList(view, 'checklist') },
          {
            key: 'Mod-f',
            run: (view) => {
              if (onSearchRequestRef.current) {
                onSearchRequestRef.current()
                return true
              }
              return openSearchPanel(view)
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        editorTheme,
        EditorView.updateListener.of((update) => {
          statesByDocumentRef.current.set(activeDocumentKeyRef.current, update.state)
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            onSessionChangeRef.current({
              selectionStart: update.state.selection.main.from,
              selectionEnd: update.state.selection.main.to,
              scrollTop: update.view.scrollDOM.scrollTop,
            })
          }
          if (update.docChanged || update.transactions.some((transaction) => transaction.isUserEvent('undo') || transaction.isUserEvent('redo'))) {
            reportHistoryStatus(update.state)
          }
        }),
      ],
    })
  }, [historyLimit])

  useImperativeHandle(ref, () => ({
    getSelection() {
      const view = viewRef.current
      if (!view) return null
      return {
        value: view.state.doc.toString(),
        selectionStart: view.state.selection.main.from,
        selectionEnd: view.state.selection.main.to,
      }
    },
    getSelectionRect() {
      const view = viewRef.current
      if (!view) return null
      const { from, to } = view.state.selection.main
      if (from === to) return null
      const start = view.coordsAtPos(from)
      if (!start) return null
      return { bottom: start.bottom, left: start.left, right: start.right, top: start.top }
    },
    getParagraphStartAt(from: number) {
      const view = viewRef.current
      if (!view) return null
      const doc = view.state.doc
      if (from < 0 || from > doc.length) return null
      // Paragrafo = bloco de linhas contiguas nao vazias que contem `from`;
      // volta ate a linha anterior em branco (ou o inicio do doc).
      let line = doc.lineAt(from)
      while (line.number > 1 && doc.line(line.number - 1).text.trim() !== '') {
        line = doc.line(line.number - 1)
      }
      return line.from
    },
    getParagraphTextAt(from: number) {
      const view = viewRef.current
      if (!view) return null
      const doc = view.state.doc
      if (from < 0 || from > doc.length) return null
      let line = doc.lineAt(from)
      const lines: string[] = [line.text]
      while (line.number < doc.lines && doc.line(line.number + 1).text.trim() !== '') {
        line = doc.line(line.number + 1)
        lines.push(line.text)
      }
      return lines.join(' ')
    },
    getRectAt(from: number) {
      const view = viewRef.current
      if (!view) return null
      const doc = view.state.doc
      if (from < 0 || from > doc.length) return null
      const coords = view.coordsAtPos(from)
      if (!coords) return null
      return { bottom: coords.bottom, left: coords.left, right: coords.right, top: coords.top }
    },
    focus() {
      viewRef.current?.focus()
    },
    redo() {
      const view = viewRef.current
      return view ? redo(view) : false
    },
    selectRange(from: number, to: number) {
      const view = viewRef.current
      if (!view) return
      view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true })
    },
    setFindQuery(query: string) {
      const view = viewRef.current
      if (!view) return
      view.dispatch({ effects: findQueryEffect.of(query) })
    },
    undo() {
      const view = viewRef.current
      return view ? undo(view) : false
    },
  }), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const storedInitialState = statesByDocumentRef.current.get(initialDocumentKeyRef.current)
    const initialState = storedInitialState && storedInitialState.doc.toString() === initialValueRef.current
      ? storedInitialState
      : createEditorState(initialValueRef.current, initialSessionRef.current)
    const view = new EditorView({
      parent: container,
      state: initialState,
    })
    viewRef.current = view
    statesByDocumentRef.current.set(initialDocumentKeyRef.current, view.state)
    reportHistoryStatus(view.state)

    const handleScroll = () => {
      onSessionChangeRef.current({
        selectionStart: view.state.selection.main.from,
        selectionEnd: view.state.selection.main.to,
        scrollTop: view.scrollDOM.scrollTop,
      })
    }
    view.scrollDOM.addEventListener('scroll', handleScroll)
    if (autoFocusRef.current) requestAnimationFrame(() => view.focus())

    return () => {
      view.scrollDOM.removeEventListener('scroll', handleScroll)
      view.destroy()
      viewRef.current = null
    }
  }, [createEditorState])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const previousDocumentKey = activeDocumentKeyRef.current
    const documentChanged = previousDocumentKey !== documentKey
    const currentValue = view.state.doc.toString()
    if (!documentChanged && currentValue === value) return

    if (documentChanged) {
      statesByDocumentRef.current.set(previousDocumentKey, view.state)
      const storedState = statesByDocumentRef.current.get(documentKey)
      const nextState = storedState && storedState.doc.toString() === value
        ? storedState
        : createEditorState(value, session)

      view.setState(nextState)
      statesByDocumentRef.current.set(documentKey, nextState)
      activeDocumentKeyRef.current = documentKey
      reportHistoryStatus(nextState)
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = session?.scrollTop ?? 0
      })
      return
    }

    const selectionStart = Math.min(session?.selectionStart ?? 0, value.length)
    const selectionEnd = Math.min(session?.selectionEnd ?? selectionStart, value.length)
    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
      selection: { anchor: selectionStart, head: selectionEnd },
    })
    activeDocumentKeyRef.current = documentKey
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = session?.scrollTop ?? 0
    })
  }, [createEditorState, documentKey, session, value])

  return <div ref={containerRef} className="codemirror-markdown-editor" />
}

const MarkdownCodeEditor = forwardRef(MarkdownCodeEditorComponent)

export { MarkdownCodeEditor }
