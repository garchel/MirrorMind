import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { ForwardedRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { getMarkdownAutocompleteResult, type MarkdownAutocompleteData } from '../lib/markdown-autocomplete'

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
  focus: () => void
  redo: () => boolean
  undo: () => boolean
}

type MarkdownCodeEditorProps = {
  ariaLabel?: string
  autoFocus?: boolean
  documentKey: string
  onBlur?: () => void
  onChange: (value: string) => void
  onHistoryChange: (status: MarkdownEditorHistoryStatus) => void
  onSearchRequest?: () => void
  onSessionChange: (session: MarkdownEditorSession) => void
  searchRequestId?: number
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
})

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

function MarkdownCodeEditorComponent(
  { ariaLabel = 'Editor Markdown', autoFocus = false, autocompleteData = { attachments: [], notePaths: [], tags: [] }, documentKey, onBlur, onChange, onHistoryChange, onSearchRequest, onSessionChange, searchRequestId, session, spellCheck = true, stateCache, value }: MarkdownCodeEditorProps,
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
  const handledSearchRequestRef = useRef(searchRequestId)
  const autocompleteDataRef = useRef(autocompleteData)
  const spellCheckRef = useRef(spellCheck)
  const ariaLabelRef = useRef(ariaLabel)

  onChangeRef.current = onChange
  onBlurRef.current = onBlur
  onHistoryChangeRef.current = onHistoryChange
  onSearchRequestRef.current = onSearchRequest
  onSessionChangeRef.current = onSessionChange
  autocompleteDataRef.current = autocompleteData
  spellCheckRef.current = spellCheck
  ariaLabelRef.current = ariaLabel

  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute('spellcheck', String(spellCheck))
  }, [spellCheck])

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
        history(),
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        search({ top: true }),
        autocompletion({
          activateOnTyping: true,
          override: [(context) => contextualCompletions(context, autocompleteDataRef.current)],
        }),
        EditorView.lineWrapping,
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
  }, [])

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
    focus() {
      viewRef.current?.focus()
    },
    redo() {
      const view = viewRef.current
      return view ? redo(view) : false
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

  useEffect(() => {
    if (searchRequestId === undefined || searchRequestId === handledSearchRequestRef.current) return
    handledSearchRequestRef.current = searchRequestId
    if (viewRef.current) openSearchPanel(viewRef.current)
  }, [searchRequestId])

  return <div ref={containerRef} className="codemirror-markdown-editor" />
}

const MarkdownCodeEditor = forwardRef(MarkdownCodeEditorComponent)

export { MarkdownCodeEditor }
