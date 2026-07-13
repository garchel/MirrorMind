import { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef } from 'react'
import type { ForwardedRef } from 'react'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

export type MarkdownEditorSession = {
  selectionStart: number
  selectionEnd: number
  scrollTop: number
}

export type MarkdownCodeEditorHandle = {
  getSelection: () => { value: string; selectionStart: number; selectionEnd: number } | null
  focus: () => void
}

type MarkdownCodeEditorProps = {
  autoFocus?: boolean
  documentKey: string
  onChange: (value: string) => void
  onSessionChange: (session: MarkdownEditorSession) => void
  session?: MarkdownEditorSession
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

function MarkdownCodeEditorComponent(
  { autoFocus = false, documentKey, onChange, onSessionChange, session, value }: MarkdownCodeEditorProps,
  ref: ForwardedRef<MarkdownCodeEditorHandle>,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const activeDocumentKeyRef = useRef(documentKey)
  const initialValueRef = useRef(value)
  const autoFocusRef = useRef(autoFocus)
  const onChangeEvent = useEffectEvent(onChange)
  const onSessionChangeEvent = useEffectEvent(onSessionChange)

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
  }), [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          history(),
          markdown(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeEvent(update.state.doc.toString())
            if (update.docChanged || update.selectionSet) {
              onSessionChangeEvent({
                selectionStart: update.state.selection.main.from,
                selectionEnd: update.state.selection.main.to,
                scrollTop: update.view.scrollDOM.scrollTop,
              })
            }
          }),
        ],
      }),
    })
    viewRef.current = view

    const handleScroll = () => {
      onSessionChangeEvent({
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
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const documentChanged = activeDocumentKeyRef.current !== documentKey
    const currentValue = view.state.doc.toString()
    if (!documentChanged && currentValue === value) return

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
  }, [documentKey, session?.scrollTop, session?.selectionEnd, session?.selectionStart, value])

  return <div ref={containerRef} className="codemirror-markdown-editor" />
}

const MarkdownCodeEditor = forwardRef(MarkdownCodeEditorComponent)

export { MarkdownCodeEditor }
