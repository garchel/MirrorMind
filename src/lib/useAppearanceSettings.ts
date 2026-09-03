import { useCallback } from 'react'
import {
  DEFAULT_WORKSPACE_SHORTCUTS,
  type WorkspaceShortcuts,
} from './keyboard-shortcuts'
import {
  clampFontSize,
  clampHistoryLimit,
  DEFAULT_FONT_SIZE,
  DEFAULT_HISTORY_LIMIT,
  normalizeFontFamily,
  normalizeThemeMode,
  type EditorFontFamily,
  type ThemeMode,
} from './appearance'
import {
  serializeBoolean,
  serializeJson,
  serializeNumber,
  serializeString,
  usePref,
} from './prefs'

/** Tipos que viviam no `App.tsx`; movidos para ca sem mudanca (so o App usa). */
export type ReadingFont = 'sans' | 'serif' | 'mono'
export type ReadingWidth = 'compact' | 'comfortable' | 'wide'

/** Aparência, leitura, editor e atalhos com persistência global.
 *
 * Extraído do `App.tsx`: 13 estados com inicialização de `localStorage` +
 * 13 efeitos de gravação viram 13 `usePref` (a gravação é automática no
 * setter). Chaves e semântica idênticas, incluindo os detalhes sutis:
 *
 * - autosave, quebra de linha e spell-check: LIGADOS por padrão (ausente no
 *   storage = habilitado; só `"false"` explícito desliga);
 * - atalhos: mescla sobre os padrões + migração do antigo `Ctrl+Shift+M`
 *   para `Ctrl+M`;
 * - tema/família passam pelos mesmos normalizadores; fonte/tamanho e
 *   limite de histórico pelos mesmos clamps (NaN = padrão).
 */
function parseShortcuts(raw: string): WorkspaceShortcuts {
  const stored = JSON.parse(raw) as Partial<WorkspaceShortcuts>
  if (stored === null || typeof stored !== 'object') throw new Error('valor inválido')
  if (stored.cycleNoteViewMode === 'Ctrl+Shift+M') delete stored.cycleNoteViewMode
  return { ...DEFAULT_WORKSPACE_SHORTCUTS, ...stored }
}

/** Ausente = habilitado; só `"false"` desliga (autosave, quebra, spell). */
const parseDefaultTrue = (raw: string): boolean => raw !== 'false'
/** Ausente = desabilitado; só `"true"` liga (pular confirmação de lixeira). */
const parseDefaultFalse = (raw: string): boolean => raw === 'true'
/** Repasse sem validação (cores, fonte/largura de leitura: como no App). */
const parseIdentity = (raw: string): string => raw
const parseThemeMode = (raw: string): ThemeMode => normalizeThemeMode(raw)
const parseEditorFontFamily = (raw: string): EditorFontFamily => normalizeFontFamily(raw)
const parseEditorFontSize = (raw: string): number => clampFontSize(Number(raw))
const parseHistoryLimit = (raw: string): number => clampHistoryLimit(Number(raw))

export function useAppearanceSettings() {
  const [shortcuts, setShortcuts] = usePref(
    'mirrormind.shortcuts', DEFAULT_WORKSPACE_SHORTCUTS, parseShortcuts, serializeJson,
  )
  const [isAutoSaveEnabled, setAutoSaveEnabled] = usePref(
    'mirrormind.auto-save', true, parseDefaultTrue, serializeBoolean,
  )
  const [noteHoverColor, setNoteHoverColor] = usePref(
    'mirrormind.note-hover-color', '#171716', parseIdentity, serializeString,
  )
  const [tabHoverColor, setTabHoverColor] = usePref(
    'mirrormind.tab-hover-color', '#171716', parseIdentity, serializeString,
  )
  const [tabHoverTextColor, setTabHoverTextColor] = usePref(
    'mirrormind.tab-hover-text-color', '#fbfaf6', parseIdentity, serializeString,
  )
  const [readingFont, setReadingFont] = usePref<ReadingFont>(
    'mirrormind.reading-font', 'sans', parseIdentity as (raw: string) => ReadingFont, serializeString,
  )
  const [themeMode, setThemeMode] = usePref(
    'mirrormind.appearance.theme', 'light' as ThemeMode, parseThemeMode, serializeString,
  )
  const [editorFontFamily, setEditorFontFamily] = usePref(
    'mirrormind.appearance.font-family', 'sans' as EditorFontFamily, parseEditorFontFamily, serializeString,
  )
  const [editorFontSize, setEditorFontSize] = usePref(
    'mirrormind.appearance.font-size', DEFAULT_FONT_SIZE, parseEditorFontSize, serializeNumber,
  )
  const [historyLimit, setHistoryLimit] = usePref(
    'mirrormind.appearance.history-limit', DEFAULT_HISTORY_LIMIT, parseHistoryLimit, serializeNumber,
  )
  const [readingWidth, setReadingWidth] = usePref<ReadingWidth>(
    'mirrormind.reading-width', 'comfortable', parseIdentity as (raw: string) => ReadingWidth, serializeString,
  )
  const [isReadingLineWrapEnabled, setReadingLineWrapEnabled] = usePref(
    'mirrormind.reading-line-wrap', true, parseDefaultTrue, serializeBoolean,
  )
  const [isSpellCheckEnabled, setSpellCheckEnabled] = usePref(
    'mirrormind.spell-check', true, parseDefaultTrue, serializeBoolean,
  )
  const [skipSoftDeleteConfirmation, setSkipSoftDeleteConfirmation] = usePref(
    'mirrormind.skip-soft-delete-confirmation', false, parseDefaultFalse, serializeBoolean,
  )
  const [isPagesFullWidth, setPagesFullWidth] = usePref(
    'mirrormind.pages-full-width', false, parseDefaultFalse, serializeBoolean,
  )

  /** O `usePref` só aceita valor direto; esta é a ponte para os 6 campos de
   * captura de atalho do App (antes `setShortcuts((atual) => ...)`). */
  const patchShortcuts = useCallback((patch: Partial<WorkspaceShortcuts>) => {
    setShortcuts({ ...shortcuts, ...patch })
  }, [shortcuts, setShortcuts])

  const resetShortcuts = useCallback(() => {
    setShortcuts(DEFAULT_WORKSPACE_SHORTCUTS)
  }, [setShortcuts])

  return {
    shortcuts,
    setShortcuts,
    patchShortcuts,
    resetShortcuts,
    isAutoSaveEnabled,
    setAutoSaveEnabled,
    noteHoverColor,
    setNoteHoverColor,
    tabHoverColor,
    setTabHoverColor,
    tabHoverTextColor,
    setTabHoverTextColor,
    readingFont,
    setReadingFont,
    themeMode,
    setThemeMode,
    editorFontFamily,
    setEditorFontFamily,
    editorFontSize,
    setEditorFontSize,
    historyLimit,
    setHistoryLimit,
    readingWidth,
    setReadingWidth,
    isReadingLineWrapEnabled,
    setReadingLineWrapEnabled,
    isSpellCheckEnabled,
    setSpellCheckEnabled,
    skipSoftDeleteConfirmation,
    setSkipSoftDeleteConfirmation,
    isPagesFullWidth,
    setPagesFullWidth,
  }
}
