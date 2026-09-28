import type {
  CSSProperties,
  Dispatch,
  MouseEvent,
  PointerEvent,
  RefObject,
  SetStateAction,
} from 'react'
import {
  Bold,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Code2,
  GripHorizontal,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  PanelLeft,
  PanelTop,
  Paperclip,
  Plus,
  Quote,
  Search,
  Table2,
  TextQuote,
  X,
} from 'lucide-react'
import type { EditorState } from '@codemirror/state'
import {
  MarkdownCodeEditor,
  type MarkdownCodeEditorHandle,
  type MarkdownEditorHistoryStatus,
  type MarkdownEditorSession,
} from '../../components/MarkdownCodeEditor'
import { FormatToolbar } from '../format/FormatToolbar'
import type { useFormatToolbar } from '../format/useFormatToolbar'
import { PostitPopover } from '../postits/PostitPopover'
import type { usePostitPopover } from '../postits/usePostitPopover'
import { replaceMarkdownBody, type MarkdownFormat, type MarkdownTableAction } from '../../lib/markdown'
import type { MarkdownAutocompleteData } from '../../lib/markdown-autocomplete'
import type { LinkTarget } from '../../components/markdownLivePreview'
import type { ReviewGapData } from '../../components/markdownLivePreview'
import type { EditorMode } from './EditorHeader'
import type { ReviewGapMode } from '../settings/SettingsPage'

/** Corpo do editor (CodeMirror) extraído do `App.tsx`: busca na nota, os
 * três motores (Edição, Leitura, Misto), popover de formatação, popover de
 * post-it, contagem de palavras e barra flutuante de Markdown. O App
 * continua dono dos estados, sessões, física de post-its e callbacks. */
export type EditorNote = {
  name: string
  path: string
}

export type EditorFind = {
  open: boolean
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  setQuery: (query: string) => void
  navigate: (delta: number) => void
  close: () => void
  index: number
  total: number
}

export type EditorEngines = {
  mode: EditorMode
  codeEditorRef: RefObject<MarkdownCodeEditorHandle | null>
  historyLimit: number
  spellCheck: boolean
  stateCacheRef: RefObject<Map<string, EditorState>>
  autocompleteData: MarkdownAutocompleteData
  hideSelectionPopover: () => void
  openNoteFind: () => void
  draftContent: string
  setDraftContent: Dispatch<SetStateAction<string>>
  setHistoryStatus: Dispatch<SetStateAction<MarkdownEditorHistoryStatus>>
  sessionsByPath: Record<string, MarkdownEditorSession>
  setSessionsByPath: Dispatch<SetStateAction<Record<string, MarkdownEditorSession>>>
  panelRef: RefObject<HTMLElement | null>
  reviewGapData: ReviewGapData | null
  reviewGapMode: ReviewGapMode
  readingStyle: CSSProperties
  handleMixedOpenLink: (target: LinkTarget) => void
  resolveMixedAssetUrl: (relativePath: string) => string
  resolveMixedEmbedBody: (relativePath: string) => Promise<string>
  vaultPath: string | undefined
  noteBody: string
  lineWrap: boolean
  getActiveSelection: () => { value: string; selectionStart: number; selectionEnd: number } | null
}

export type EditorTools = {
  open: boolean
  toolsRef: RefObject<HTMLDivElement | null>
  orientation: 'horizontal' | 'vertical'
  position: { x: number; y: number }
  startDrag: (event: PointerEvent<HTMLButtonElement>) => void
  toggleOrientation: () => void
  preserveSelection: (event: MouseEvent<HTMLButtonElement>) => void
  selectTool: (format: MarkdownFormat) => void
  applyTableAction: (action: MarkdownTableAction) => void
  insertAttachment: () => void
  setShowNoteLinkDialog: (show: boolean) => void
  setShowTagDialog: (show: boolean) => void
}

export type EditorContentProps = {
  note: EditorNote
  editorContentRef: RefObject<HTMLDivElement | null>
  find: EditorFind
  engines: EditorEngines
  format: Pick<
    ReturnType<typeof useFormatToolbar>,
    | 'selectionPopover'
    | 'selectionPopoverRef'
    | 'formatSubmenu'
    | 'setFormatSubmenu'
    | 'openFormatSubmenu'
    | 'scheduleFormatSubmenuClose'
    | 'applyMarkdownFormat'
  >
  postits: Pick<
    ReturnType<typeof usePostitPopover>,
    | 'postitData'
    | 'handlePostitWidgetClick'
    | 'openPostitPeek'
    | 'schedulePostitPeekClose'
    | 'cancelPostitPeekClose'
    | 'postitPopover'
    | 'postitPopoverRef'
    | 'postitPopoverSize'
    | 'postitRangeArming'
    | 'setPostitRangeArming'
    | 'reanchorPostitToSelection'
    | 'closePostitPopover'
    | 'startPostitPopoverResize'
    | 'openPostitPopoverAtSelection'
    | 'requestDeletePostit'
    | 'updateDraftText'
    | 'updateDraftColor'
  >
  noteWordCount: number
  tools: EditorTools
}

export function EditorContent({
  note: {
    name: activeNoteName,
    path: activeNotePath,
  },
  editorContentRef,
  find: {
    open: noteFindOpen,
    inputRef: noteFindInputRef,
    query: noteFindQuery,
    setQuery: setNoteFindQuery,
    navigate: navigateNoteFind,
    close: closeNoteFind,
    index: noteFindIndex,
    total: findTotal,
  },
  engines: {
    mode: editorMode,
    codeEditorRef: markdownCodeEditorRef,
    historyLimit,
    spellCheck: isSpellCheckEnabled,
    stateCacheRef: markdownEditorStateCacheRef,
    autocompleteData: markdownAutocompleteData,
    hideSelectionPopover,
    openNoteFind,
    draftContent,
    setDraftContent,
    setHistoryStatus: setMarkdownHistoryStatus,
    sessionsByPath: editorSessionsByPath,
    setSessionsByPath: setEditorSessionsByPath,
    panelRef: editorPanelRef,
    reviewGapData,
    reviewGapMode,
    readingStyle,
    handleMixedOpenLink,
    resolveMixedAssetUrl,
    resolveMixedEmbedBody,
    vaultPath,
    noteBody,
    lineWrap: isReadingLineWrapEnabled,
    getActiveSelection: getActiveEditorSelection,
  },
  format,
  postits,
  noteWordCount,
  tools: {
    open: isMarkdownToolsOpen,
    toolsRef: markdownToolsRef,
    orientation: markdownToolsOrientation,
    position: markdownToolsPosition,
    startDrag: startMarkdownToolsDrag,
    toggleOrientation: toggleMarkdownToolsOrientation,
    preserveSelection: preserveEditorSelection,
    selectTool: selectMarkdownTool,
    applyTableAction: applyMarkdownTableAction,
    insertAttachment,
    setShowNoteLinkDialog,
    setShowTagDialog,
  },
}: EditorContentProps) {
  const {
    selectionPopover,
    selectionPopoverRef,
    formatSubmenu,
    setFormatSubmenu,
    openFormatSubmenu,
    scheduleFormatSubmenuClose,
    applyMarkdownFormat,
  } = format
  const {
    postitData,
    handlePostitWidgetClick,
    openPostitPeek,
    schedulePostitPeekClose,
    cancelPostitPeekClose,
    postitPopover,
    postitPopoverRef,
    postitPopoverSize,
    postitRangeArming,
    setPostitRangeArming,
    reanchorPostitToSelection,
    closePostitPopover,
    startPostitPopoverResize,
    openPostitPopoverAtSelection,
    requestDeletePostit,
    updateDraftText,
    updateDraftColor,
  } = postits

  return (
    <div id="note-editor" className="editor-content" ref={editorContentRef} data-builder-name="editor-content">
    {noteFindOpen ? (
      <div className="note-find-bar" role="search">
        <Search size={13} strokeWidth={1.7} aria-hidden="true" />
        <input
          ref={noteFindInputRef}
          value={noteFindQuery}
          onChange={(event) => setNoteFindQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              navigateNoteFind(event.shiftKey ? -1 : 1)
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              closeNoteFind()
            }
          }}
          placeholder="Buscar na nota"
          aria-label="Buscar na nota"
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
        <span className="note-find-count" aria-live="polite">
          {noteFindQuery.trim() && findTotal > 0 ? `${noteFindIndex + 1}/${findTotal}` : '0/0'}
        </span>
        <button type="button" className="note-find-nav-button" onClick={() => navigateNoteFind(-1)} disabled={findTotal === 0} title="Correspondência anterior" aria-label="Correspondência anterior"><ChevronUp size={14} strokeWidth={1.7} aria-hidden="true" /></button>
        <button type="button" className="note-find-nav-button" onClick={() => navigateNoteFind(1)} disabled={findTotal === 0} title="Próxima correspondência" aria-label="Próxima correspondência"><ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" /></button>
        <button type="button" className="note-find-close" onClick={closeNoteFind} title="Fechar busca (Esc)" aria-label="Fechar busca"><X size={13} strokeWidth={1.7} aria-hidden="true" /></button>
      </div>
    ) : null}
    {editorMode === 'edit' ? (
      <MarkdownCodeEditor
        ref={markdownCodeEditorRef}
        ariaLabel={`Editor Markdown da nota ${activeNoteName}`}
        documentKey={activeNotePath}
        historyLimit={historyLimit}
        spellCheck={isSpellCheckEnabled}
        stateCache={markdownEditorStateCacheRef.current}
        autocompleteData={markdownAutocompleteData}
        onBlur={hideSelectionPopover}
        onSearchRequest={openNoteFind}
        value={draftContent}
        onHistoryChange={setMarkdownHistoryStatus}
        session={editorSessionsByPath[activeNotePath]}
        onChange={setDraftContent}
        onSessionChange={(session) => {
          setEditorSessionsByPath((currentSessions) => ({
            ...currentSessions,
            [activeNotePath]: session,
          }))
        }}
      />
    ) : editorMode === 'read' ? (
      <section ref={editorPanelRef} className={`markdown-mixed markdown-reading-engine${reviewGapData ? ' has-gap-marks' : ''}${reviewGapMode === 'hover' ? ' is-gap-hover-only' : ''}`} style={readingStyle}>
        <MarkdownCodeEditor
          ref={markdownCodeEditorRef}
          ariaLabel={`Leitura da nota ${activeNoteName}`}
          documentKey={`${activeNotePath}::leitura`}
          livePreview
          readOnly
          lineWrap={isReadingLineWrapEnabled}
          historyLimit={historyLimit}
          spellCheck={isSpellCheckEnabled}
          stateCache={markdownEditorStateCacheRef.current}
          autocompleteData={markdownAutocompleteData}
          onBlur={hideSelectionPopover}
          onOpenLink={handleMixedOpenLink}
          resolveAssetUrl={resolveMixedAssetUrl}
          getEmbedContent={resolveMixedEmbedBody}
          vaultPath={vaultPath}
          reviewGapData={reviewGapData}
          postitData={postitData}
          onPostitClick={handlePostitWidgetClick}
          onPostitPeek={{ onOpen: openPostitPeek, onClose: schedulePostitPeekClose }}
          onSearchRequest={openNoteFind}
          value={noteBody}
          // O doc do Leitura e `noteBody` (sem frontmatter): o merge
          // preserva o frontmatter do draft ao alternar um checkbox.
          onChange={(content) => setDraftContent((current) => replaceMarkdownBody(current, content))}
          onHistoryChange={setMarkdownHistoryStatus}
          onSessionChange={(session) => {
            setEditorSessionsByPath((currentSessions) => ({
              ...currentSessions,
              [`${activeNotePath}::leitura`]: session,
            }))
          }}
          session={editorSessionsByPath[`${activeNotePath}::leitura`]}
        />
      </section>
    ) : (
      <section ref={editorPanelRef} className={`markdown-mixed${reviewGapData ? ' has-gap-marks' : ''}${reviewGapMode === 'hover' ? ' is-gap-hover-only' : ''}`}>
        <MarkdownCodeEditor
          ref={markdownCodeEditorRef}
          ariaLabel={`Editor Markdown (Misto) da nota ${activeNoteName}`}
          documentKey={`${activeNotePath}::misto::gfm`}
          livePreview
          historyLimit={historyLimit}
          spellCheck={isSpellCheckEnabled}
          stateCache={markdownEditorStateCacheRef.current}
          autocompleteData={markdownAutocompleteData}
          onBlur={hideSelectionPopover}
          onOpenLink={handleMixedOpenLink}
          resolveAssetUrl={resolveMixedAssetUrl}
          getEmbedContent={resolveMixedEmbedBody}
          vaultPath={vaultPath}
          postitData={postitData}
          onPostitClick={handlePostitWidgetClick}
          onPostitPeek={{ onOpen: openPostitPeek, onClose: schedulePostitPeekClose }}
          onSearchRequest={openNoteFind}
          value={draftContent}
          onChange={setDraftContent}
          onHistoryChange={setMarkdownHistoryStatus}
          onSessionChange={(session) => {
            setEditorSessionsByPath((currentSessions) => ({
              ...currentSessions,
              [`${activeNotePath}::misto::gfm`]: session,
            }))
          }}
          session={editorSessionsByPath[`${activeNotePath}::misto::gfm`]}
        />
      </section>
    )}
    {selectionPopover && editorMode !== 'read' ? (
      <FormatToolbar
        popover={selectionPopover}
        popoverRef={selectionPopoverRef}
        submenu={formatSubmenu}
        setSubmenu={setFormatSubmenu}
        onOpenSubmenu={openFormatSubmenu}
        onScheduleCloseSubmenu={scheduleFormatSubmenuClose}
        onApplyFormat={applyMarkdownFormat}
        onOpenPostit={(color) => openPostitPopoverAtSelection(color)}
      />
    ) : null}
    {postitPopover && editorMode !== 'edit' ? (
      <PostitPopover
        popover={postitPopover}
        containerRef={postitPopoverRef}
        size={postitPopoverSize}
        editable={editorMode !== 'read'}
        rangeArming={postitRangeArming}
        canReanchor={(() => {
          if (editorMode === 'read') return false
          const selection = getActiveEditorSelection()
          return !!selection && selection.selectionEnd > selection.selectionStart
        })()}
        peekPostitId={postitPopover.peek ? postitPopover.postitId : null}
        onArmRange={() => setPostitRangeArming(true)}
        onConfirmRange={reanchorPostitToSelection}
        onClose={closePostitPopover}
        onResizeStart={startPostitPopoverResize}
        onPeekEnter={cancelPostitPeekClose}
        onPeekLeave={(postitId) => schedulePostitPeekClose(postitId)}
        onDeleteRequest={requestDeletePostit}
        onDraftTextChange={updateDraftText}
        onDraftColorChange={updateDraftColor}
      />
    ) : null}
    <div className="note-word-count" data-testid="note-word-count" title={`${noteWordCount} palavra${noteWordCount === 1 ? '' : 's'}`}>
      {noteWordCount} palavra{noteWordCount === 1 ? '' : 's'}
    </div>
    {isMarkdownToolsOpen && editorMode !== 'read' ? (
      <div
        ref={markdownToolsRef}
        className={`floating-markdown-toolbar is-${markdownToolsOrientation}`}
        role="toolbar"
        aria-label="Ferramentas de Markdown"
        style={{ right: markdownToolsPosition.x, top: markdownToolsPosition.y }}
      >
        <button type="button" className="markdown-tools-drag-handle" onPointerDown={startMarkdownToolsDrag} title="Arrastar ferramentas" aria-label="Arrastar ferramentas">
          <GripHorizontal size={15} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button type="button" className="markdown-tools-orientation" onClick={toggleMarkdownToolsOrientation} title={markdownToolsOrientation === 'horizontal' ? 'Usar barra vertical' : 'Usar barra horizontal'} aria-label={markdownToolsOrientation === 'horizontal' ? 'Usar barra vertical' : 'Usar barra horizontal'}>
          {markdownToolsOrientation === 'horizontal' ? <PanelLeft size={15} strokeWidth={1.5} aria-hidden="true" /> : <PanelTop size={15} strokeWidth={1.5} aria-hidden="true" />}
        </button>
        <div className="markdown-toolbar-group" aria-label="Titulos">
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('heading1')} title="Titulo 1" aria-label="Titulo 1"><Heading1 size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('heading2')} title="Titulo 2" aria-label="Titulo 2"><Heading2 size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('heading3')} title="Titulo 3" aria-label="Titulo 3"><Heading3 size={16} /></button>
        </div>
        <div className="markdown-toolbar-group" aria-label="Texto">
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('bold')} title="Negrito (Ctrl+B)" aria-label="Negrito (Ctrl+B)"><Bold size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('italic')} title="Italico (Ctrl+I)" aria-label="Italico (Ctrl+I)"><Italic size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('link')} title="Link" aria-label="Link"><Link size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('quote')} title="Citação" aria-label="Citação"><TextQuote size={16} /></button>
        </div>
        <div className="markdown-toolbar-group" aria-label="Listas">
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('list')} title="Lista" aria-label="Lista"><List size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('orderedList')} title="Lista numerada" aria-label="Lista numerada"><ListOrdered size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('checklist')} title="Checklist" aria-label="Checklist"><CheckSquare size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('table')} title="Inserir tabela" aria-label="Inserir tabela"><Table2 size={16} /></button>
        </div>
        <div className="markdown-toolbar-group" aria-label="Tabela">
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownTableAction('addRow')} title="Adicionar linha a tabela" aria-label="Adicionar linha a tabela"><Plus size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownTableAction('removeRow')} title="Remover linha da tabela" aria-label="Remover linha da tabela"><Minus size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownTableAction('addColumn')} title="Adicionar coluna a tabela" aria-label="Adicionar coluna a tabela"><Plus size={14} /><Table2 size={13} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => applyMarkdownTableAction('removeColumn')} title="Remover coluna da tabela" aria-label="Remover coluna da tabela"><Minus size={14} /><Table2 size={13} /></button>
        </div>
        <div className="markdown-toolbar-group" aria-label="Blocos">
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('code')} title="Codigo inline" aria-label="Codigo inline"><Code2 size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('codeBlock')} title="Bloco de codigo" aria-label="Bloco de codigo"><Quote size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => selectMarkdownTool('divider')} title="Divisor" aria-label="Divisor"><Minus size={16} /></button>
        </div>
        <div className="markdown-toolbar-group" aria-label="Insercao">
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => void insertAttachment()} title="Anexar arquivo" aria-label="Anexar arquivo"><Paperclip size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => setShowNoteLinkDialog(true)} title="Inserir link para nota" aria-label="Inserir link para nota"><Link size={16} /></button>
          <button type="button" onMouseDown={preserveEditorSelection} onClick={() => setShowTagDialog(true)} title="Inserir tag" aria-label="Inserir tag"><Hash size={16} /></button>
        </div>
      </div>
    ) : null}
    </div>
  )
}
