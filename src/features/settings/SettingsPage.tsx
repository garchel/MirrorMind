import { useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AlertTriangle, Search } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_HISTORY_LIMIT,
  FONT_FAMILIES,
  fontFamilyCss,
  MAX_FONT_SIZE,
  MAX_HISTORY_LIMIT,
  MIN_FONT_SIZE,
  MIN_HISTORY_LIMIT,
  THEME_MODES,
  clampFontSize,
  clampHistoryLimit,
  type EditorFontFamily,
} from '../../lib/appearance'
import {
  DEFAULT_WORKSPACE_SHORTCUTS,
  type WorkspaceShortcuts,
} from '../../lib/keyboard-shortcuts'
import {
  APPEARANCE_DEFAULTS,
  type ReadingFont,
  type ReadingWidth,
  type useAppearanceSettings,
} from '../../lib/useAppearanceSettings'
import type { ObsidianAppearance } from '../../lib/vault'
import type { AppUpdaterController } from '../../lib/useAppUpdater'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSectionId } from './useSettingsNav'
import { Modal } from '../../components/Modal'
import { SettingRow } from './SettingRow'
import { ShortcutKeys } from './ShortcutKeys'
import { SettingSection } from './SettingSection'
import { SettingsSearchContext, matchesQuery } from './settingsSearch'
import { ReviewAiSettings } from '../review/ReviewAiSettings'
import { ReviewNotificationSettings } from '../review/ReviewNotificationSettings'
import type { ReviewNotificationCheck } from '../review/reviewNotifications'
import { SegmentationSettings } from '../review/SegmentationSettings'
import { VaultReviewPolicySettings } from '../review/VaultReviewPolicySettings'
import { AccountSettings } from './AccountSettings'
import type { SessionClient } from '../../lib/session'
import { errorMessage } from '../../lib/tauri'

/** Como destacar os trechos esquecidos/confundidos no editor (resultado mais
 * recente). Movido do `App.tsx` sem mudança — o App importa este tipo. */

/** Padrão de fábrica do destaque de lacunas (o `usePref` do App usa `hover`). */

/** O que o usuário precisa digitar para liberar a ação destrutiva. */

/** Linhas de atalho, na ordem da tela. Uma lista só evita seis blocos iguais e
 * deixa a detecção de conflito e o "restaurar" valerem para todas. */
const SHORTCUT_ROWS: { key: keyof WorkspaceShortcuts; label: string; description: string }[] = [
  { key: 'createNote', label: 'Criar nova nota', description: 'Abre a captura de uma nova nota no explorador.' },
  { key: 'saveNote', label: 'Salvar nota', description: 'Salva as alterações da nota aberta.' },
  { key: 'cycleNoteViewMode', label: 'Alternar modo de visualização', description: 'Alterna entre os modos Misto, Edição e Leitura.' },
  { key: 'openNote', label: 'Abrir nota existente', description: 'Abre a busca rápida de notas do vault.' },
  { key: 'openTagFilter', label: 'Abrir filtro de tags', description: 'Abre o filtro completo de tags do explorador.' },
  { key: 'openCommandPalette', label: 'Abrir Command Palette', description: 'Abre a busca de comandos do workspace.' },
]

/** Página de Configurações: o App continua dono dos hooks e passa os valores. */
export type SettingsPageProps = {
  vaultPath: string
  obsidianAppearance: ObsidianAppearance | null
  appearance: ReturnType<typeof useAppearanceSettings>
  notificationLastCheck: ReviewNotificationCheck | null
  onCheckReviewNotifications: () => void
  appVersion: string | null
  appUpdater: AppUpdaterController
  autoUpdateEnabled: boolean
  onToggleAutoUpdate: (enabled: boolean) => void
  activeSettingsSection: SettingsSectionId
  onNavigateSettingsSection: (sectionId: SettingsSectionId) => void
  settingsScrollRef: RefObject<HTMLElement | null>
  /** Cliente de conta (null = seção oculta; App injeta quando a cobrança liga). */
  accountClient: SessionClient | null
  /** Abre a página de conta (formulários saíram daqui). */
  onOpenAccount: () => void
}

/** Amostra viva da fonte: o rótulo "Serif" não mostra como a nota fica. */
function FontSample({ family, size, label }: { family: EditorFontFamily; size: number; label: string }) {
  return (
    <p className="settings-font-sample">
      <span className="settings-font-sample-label">{label}</span>
      <span className="settings-font-sample-text" style={{ fontFamily: fontFamilyCss(family), fontSize: `${size}px` }}>
        Aa — O rato roeu a roupa do rei de Roma.
      </span>
    </p>
  )
}

export function SettingsPage({
  vaultPath,
  obsidianAppearance,
  appearance,
  notificationLastCheck,
  onCheckReviewNotifications,
  appVersion,
  appUpdater,
  autoUpdateEnabled,
  onToggleAutoUpdate,
  activeSettingsSection,
  onNavigateSettingsSection,
  settingsScrollRef,
  accountClient,
  onOpenAccount,
}: SettingsPageProps) {
  const {
    shortcuts,
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
    isPagesFullWidth,
    setPagesFullWidth,
  } = appearance

  const [query, setQuery] = useState('')
  /** Confirmacao em dois passos: a lista do que some aparece antes do campo. */
  const [clearOpen, setClearOpen] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearStatus, setClearStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)

  /** Combinações repetidas: o app escolhe uma vencedora em silêncio, então a
   * tela precisa dizer que existe conflito. */
  const shortcutConflicts = useMemo(() => {
    const byValue = new Map<string, string[]>()
    for (const row of SHORTCUT_ROWS) {
      const value = shortcuts[row.key]
      byValue.set(value, [...(byValue.get(value) ?? []), row.label])
    }
    return new Map([...byValue].filter(([, labels]) => labels.length > 1))
  }, [shortcuts])

  const changed = {
    theme: themeMode !== APPEARANCE_DEFAULTS.themeMode,
    pagesWidth: isPagesFullWidth !== APPEARANCE_DEFAULTS.isPagesFullWidth,
    fontFamily: editorFontFamily !== APPEARANCE_DEFAULTS.editorFontFamily,
    fontSize: editorFontSize !== APPEARANCE_DEFAULTS.editorFontSize,
    history: historyLimit !== APPEARANCE_DEFAULTS.historyLimit,
    autoSave: isAutoSaveEnabled !== APPEARANCE_DEFAULTS.isAutoSaveEnabled,
    noteHover: noteHoverColor.toLowerCase() !== APPEARANCE_DEFAULTS.noteHoverColor,
    tabHover: tabHoverColor.toLowerCase() !== APPEARANCE_DEFAULTS.tabHoverColor,
    tabHoverText: tabHoverTextColor.toLowerCase() !== APPEARANCE_DEFAULTS.tabHoverTextColor,
    readingFont: readingFont !== APPEARANCE_DEFAULTS.readingFont,
    readingWidth: readingWidth !== APPEARANCE_DEFAULTS.readingWidth,
    lineWrap: isReadingLineWrapEnabled !== APPEARANCE_DEFAULTS.isReadingLineWrapEnabled,
    spellCheck: isSpellCheckEnabled !== APPEARANCE_DEFAULTS.isSpellCheckEnabled,
    autoUpdate: !autoUpdateEnabled,
  }
  const anyAppearanceChange = changed.theme || changed.pagesWidth
    || changed.noteHover || changed.tabHover || changed.tabHoverText

  /** So a Aparência: Editor e Leitura tem restaurar por linha. */
  function resetAppearance() {
    setThemeMode(APPEARANCE_DEFAULTS.themeMode)
    setPagesFullWidth(APPEARANCE_DEFAULTS.isPagesFullWidth)
    setNoteHoverColor(APPEARANCE_DEFAULTS.noteHoverColor)
    setTabHoverColor(APPEARANCE_DEFAULTS.tabHoverColor)
    setTabHoverTextColor(APPEARANCE_DEFAULTS.tabHoverTextColor)
  }

  async function clearLocalData() {
    setClearBusy(true)
    setClearStatus(null)
    try {
      await invoke('clear_local_app_data')
      localStorage.clear()
      setClearOpen(false)
      setClearStatus({ kind: 'ok', message: 'Dados locais apagados. Reinicie o app para aplicar.' })
    } catch (cause) {
      setClearStatus({ kind: 'error', message: errorMessage(cause, String(cause)) })
    } finally {
      setClearBusy(false)
    }
  }

  return (
    <section ref={settingsScrollRef} className="workspace-page" data-builder-name="settings-page">
      <div className="settings-layout">
        {/* A busca nao e navegacao: fica na coluna, fora do <nav>. */}
        <div className="settings-sidebar">
          <div className="settings-search">
            <Search size={14} aria-hidden="true" />
            <Field
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar"
              aria-label="Buscar configuração"
            />
          </div>
          <nav className="settings-nav" aria-label="Seções das configurações">

          {SETTINGS_GROUPS.map((group) => (
            <div key={group.id} className="settings-nav-group" role="group" aria-label={group.label}>
              <p className="settings-nav-group-label" aria-hidden="true">{group.label}</p>
              {SETTINGS_SECTIONS
                .filter((section) => (group.sections as readonly string[]).includes(section.id))
                .map((section) => (
                  <Button
                    key={section.id}
                    variant="bare"
                    size="sm"
                    className={activeSettingsSection === section.id ? 'is-active' : ''}
                    aria-current={activeSettingsSection === section.id ? 'true' : undefined}
                    onClick={() => onNavigateSettingsSection(section.id)}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                      event.preventDefault()
                      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav button'))
                      const index = buttons.indexOf(event.currentTarget)
                      const neighbor = event.key === 'ArrowDown' ? buttons[index + 1] : buttons[index - 1]
                      neighbor?.focus()
                    }}
                  >
                    <section.icon size={15} strokeWidth={1.5} aria-hidden="true" />
                    <span>{section.label}</span>
                  </Button>
                ))}
            </div>
          ))}
          </nav>
        </div>

        <SettingsSearchContext.Provider value={{ query }}>
          <div className="settings-content" data-searching={query.trim() !== ''}>
            <header className="settings-page-header">
              <div>
                <p className="card-kicker">Configurações</p>
                <h2>Configurações do aplicativo</h2>
                <p>Personalize a escrita, a leitura, a revisão e o comportamento do app.</p>
              </div>
            </header>

            <p className="settings-empty" role="status">
              Nenhuma configuração corresponde a “{query}”.
            </p>

            <SettingSection
              id="aparencia"
              title="Aparência"
              keywords="tema claro escuro cores interface hover visual"
              aside={(
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={resetAppearance}
                  disabled={!anyAppearanceChange}
                  title="Volta tema, largura das páginas e cores de hover ao padrão"
                >
                  Restaurar aparência
                </Button>
              )}
            >
              <SettingRow
                label="Tema"
                description="Escuro aplica contraste noturno em toda a interface. A opção do vault usa o tema definido na pasta de notas, sem alterar os arquivos originais."
                changed={changed.theme}
                onReset={() => setThemeMode(APPEARANCE_DEFAULTS.themeMode)}
              >
                <div className="settings-segmented" role="radiogroup" aria-label="Tema da interface">
                  {THEME_MODES.map((option) => (
                    <Button
                      key={option.value}
                      variant="bare"
                      size="sm"
                      role="radio"
                      aria-checked={themeMode === option.value}
                      className={themeMode === option.value ? 'is-active' : ''}
                      onClick={() => setThemeMode(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow
                label="Largura das páginas"
                description="Com espaçamento mantém o respiro padrão em todas as páginas. Largura total ocupa 100% do espaço disponível."
                changed={changed.pagesWidth}
                onReset={() => setPagesFullWidth(APPEARANCE_DEFAULTS.isPagesFullWidth)}
              >
                <div className="settings-segmented" role="radiogroup" aria-label="Largura das páginas">
                  <Button
                    variant="bare"
                    size="sm"
                    role="radio"
                    aria-checked={!isPagesFullWidth}
                    className={!isPagesFullWidth ? 'is-active' : ''}
                    onClick={() => setPagesFullWidth(false)}
                  >
                    Com espaçamento
                  </Button>
                  <Button
                    variant="bare"
                    size="sm"
                    role="radio"
                    aria-checked={isPagesFullWidth}
                    className={isPagesFullWidth ? 'is-active' : ''}
                    onClick={() => setPagesFullWidth(true)}
                  >
                    Largura total
                  </Button>
                </div>
              </SettingRow>

              <SettingRow
                label="Cor do hover das notas"
                description="Define a cor de fundo ao passar o mouse sobre uma nota no explorador."
                changed={changed.noteHover}
                onReset={() => setNoteHoverColor(APPEARANCE_DEFAULTS.noteHoverColor)}
              >
                <input
                  type="color"
                  value={noteHoverColor}
                  onChange={(event) => setNoteHoverColor(event.target.value)}
                  aria-label="Cor do hover das notas"
                />
              </SettingRow>

              <SettingRow
                label="Cor do hover das abas"
                description="Define a cor de fundo ao passar o mouse por uma aba aberta."
                changed={changed.tabHover}
                onReset={() => setTabHoverColor(APPEARANCE_DEFAULTS.tabHoverColor)}
              >
                <input
                  type="color"
                  value={tabHoverColor}
                  onChange={(event) => setTabHoverColor(event.target.value)}
                  aria-label="Cor do hover das abas"
                />
              </SettingRow>

              <SettingRow
                label="Cor do texto no hover das abas"
                description="Define a cor do título e do ícone de fechar enquanto uma aba está em hover."
                changed={changed.tabHoverText}
                onReset={() => setTabHoverTextColor(APPEARANCE_DEFAULTS.tabHoverTextColor)}
              >
                <input
                  type="color"
                  value={tabHoverTextColor}
                  onChange={(event) => setTabHoverTextColor(event.target.value)}
                  aria-label="Cor do texto no hover das abas"
                />
              </SettingRow>
            </SettingSection>

            <SettingSection
              id="editor"
              title="Editor"
              keywords="fonte tipografia tamanho pixel historico desfazer salvar automatico autosave"
            >
              <fieldset className="settings-group">
                <legend className="settings-group-legend">Tipografia do editor</legend>

                <SettingRow
                  label="Fonte"
                  description="Família aplicada aos modos Edição, Misto e Leitura."
                  changed={changed.fontFamily}
                  onReset={() => setEditorFontFamily(APPEARANCE_DEFAULTS.editorFontFamily)}
                >
                  <Field as="select" className="settings-select" value={editorFontFamily} onChange={(event) => setEditorFontFamily(event.target.value as EditorFontFamily)} aria-label="Família da fonte do editor e da leitura">
                    {FONT_FAMILIES.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </Field>
                </SettingRow>

                <SettingRow
                  label="Tamanho"
                  description={obsidianAppearance?.baseFontSize
                    ? `O vault define ${Math.round(obsidianAppearance.baseFontSize)}px — aplique com o botão ao lado.`
                    : 'Medida base do texto em pixels.'}
                  keywords="tamanho vault obsidian pixel"
                  changed={changed.fontSize}
                  onReset={() => setEditorFontSize(APPEARANCE_DEFAULTS.editorFontSize)}
                >
                  <div className="settings-control-group">
                    <Field
                      className="settings-number"
                      type="number"
                      min={MIN_FONT_SIZE}
                      max={MAX_FONT_SIZE}
                      step={1}
                      value={editorFontSize}
                      onChange={(event) => setEditorFontSize(clampFontSize(Number(event.target.value)))}
                      aria-label="Tamanho da fonte do editor e da leitura"
                    />
                    {obsidianAppearance?.baseFontSize ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditorFontSize(clampFontSize(obsidianAppearance?.baseFontSize ?? DEFAULT_FONT_SIZE))}
                        title="Aplicar o tamanho definido no vault, sem alterar os arquivos"
                      >
                        Usar {Math.round(obsidianAppearance.baseFontSize)}px
                      </Button>
                    ) : null}
                  </div>
                </SettingRow>

                <FontSample family={editorFontFamily} size={editorFontSize} label="Exemplo" />
              </fieldset>

              <SettingRow
                label="Limite do histórico"
                description={`Ações de desfazer/refazer mantidas por nota no editor (${DEFAULT_HISTORY_LIMIT} por padrão).`}
                keywords="desfazer refazer undo redo"
                changed={changed.history}
                onReset={() => setHistoryLimit(APPEARANCE_DEFAULTS.historyLimit)}
              >
                <Field
                  className="settings-number"
                  type="number"
                  min={MIN_HISTORY_LIMIT}
                  max={MAX_HISTORY_LIMIT}
                  step={5}
                  value={historyLimit}
                  onChange={(event) => setHistoryLimit(clampHistoryLimit(Number(event.target.value)))}
                  aria-label="Limite do histórico de desfazer e refazer"
                />
              </SettingRow>

              <SettingRow
                label="Salvamento automático"
                description="Salva após uma breve pausa na digitação, sem interromper a edição."
                keywords="autosave salvar"
              >
                <input
                  type="checkbox"
                  checked={isAutoSaveEnabled}
                  onChange={(event) => setAutoSaveEnabled(event.target.checked)}
                  aria-label="Salvamento automático"
                />
              </SettingRow>

              {obsidianAppearance?.ignoredAppearanceFields.length ? (
                <p className="settings-note" role="status">
                  {obsidianAppearance.ignoredAppearanceFields.length} ajuste(s) de aparência do vault tinham formato inválido e foram ignorados; os demais foram mantidos.
                </p>
              ) : null}
            </SettingSection>

            <SettingSection
              id="leitura"
              title="Leitura"
              keywords="fonte linha quebra corretor ortográfico coluna"
            >
              <fieldset className="settings-group">
                <legend className="settings-group-legend">Tipografia da leitura</legend>

                <SettingRow
                  label="Fonte"
                  description="Família tipográfica usada no modo Leitura."
                  changed={changed.readingFont}
                  onReset={() => setReadingFont(APPEARANCE_DEFAULTS.readingFont)}
                >
                  <Field as="select" className="settings-select" value={readingFont} onChange={(event) => setReadingFont(event.target.value as ReadingFont)} aria-label="Fonte de leitura">
                    <option value="sans">Sans serif</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Monoespacada</option>
                  </Field>
                </SettingRow>

                <FontSample family={readingFont as EditorFontFamily} size={editorFontSize} label="Exemplo" />
              </fieldset>

              <SettingRow
                label="Largura da leitura"
                description="Controla a medida da coluna de conteúdo no modo Leitura."
                changed={changed.readingWidth}
                onReset={() => setReadingWidth(APPEARANCE_DEFAULTS.readingWidth)}
              >
                <Field as="select" className="settings-select" value={readingWidth} onChange={(event) => setReadingWidth(event.target.value as ReadingWidth)} aria-label="Largura da leitura">
                  <option value="compact">Compacta</option>
                  <option value="comfortable">Confortável</option>
                  <option value="wide">Ampla</option>
                </Field>
              </SettingRow>

              <SettingRow
                label="Quebra de linha"
                description="Desative para manter linhas longas em uma única linha no modo Leitura."
                changed={changed.lineWrap}
                onReset={() => setReadingLineWrapEnabled(APPEARANCE_DEFAULTS.isReadingLineWrapEnabled)}
              >
                <input type="checkbox" checked={isReadingLineWrapEnabled} onChange={(event) => setReadingLineWrapEnabled(event.target.checked)} aria-label="Quebra de linha na leitura" />
              </SettingRow>

              <SettingRow
                label="Corretor ortográfico"
                description="Usa o corretor nativo do sistema nos modos Edição e Misto."
                changed={changed.spellCheck}
                onReset={() => setSpellCheckEnabled(APPEARANCE_DEFAULTS.isSpellCheckEnabled)}
              >
                <input type="checkbox" checked={isSpellCheckEnabled} onChange={(event) => setSpellCheckEnabled(event.target.checked)} aria-label="Corretor ortográfico" />
              </SettingRow>
            </SettingSection>

            <SettingSection
              id="atalhos"
              title="Atalhos"
              description="Selecione um campo e pressione a nova combinação de teclas."
              keywords="teclado combinacao comando ctrl"
              aside={(
                <Button type="button" variant="secondary" size="sm" onClick={resetShortcuts}>
                  Restaurar atalhos
                </Button>
              )}
            >
              {shortcutConflicts.size > 0 ? (
                <div className="settings-warning" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>
                    {[...shortcutConflicts.entries()]
                      .map(([combo, labels]) => `${combo} está em ${labels.length} ações`)
                      .join('; ')}. Só uma delas será disparada.
                  </span>
                </div>
              ) : null}

              {SHORTCUT_ROWS.map((row) => {
                const value = shortcuts[row.key]
                const isDefault = value === DEFAULT_WORKSPACE_SHORTCUTS[row.key]
                const hasConflict = shortcutConflicts.has(value)
                return (
                  <SettingRow
                    key={row.key}
                    label={row.label}
                    description={hasConflict ? `${row.description} Em conflito com outra ação.` : row.description}
                    changed={!isDefault}
                    onReset={() => patchShortcuts({ [row.key]: DEFAULT_WORKSPACE_SHORTCUTS[row.key] })}
                  >
                    <ShortcutKeys
                      keys={value}
                      label={row.label}
                      invalid={hasConflict}
                      onCapture={(combo) => patchShortcuts({ [row.key]: combo })}
                    />
                  </SettingRow>
                )
              })}
            </SettingSection>

            <SettingSection
              id="revisao"
              title="Revisão"
              description="Estes são os padrões do vault. Tags e notas podem sobrescrever retenção, intervalos e prazo — o que vale é sempre o mais específico."
              keywords="retenção intervalo prioridade segmentação notificação ritmo"
            >
              <div className="settings-block" data-block-match={matchesQuery(query, 'ritmo do vault retenção intervalo prioridade padrão')}>
                <VaultReviewPolicySettings vaultPath={vaultPath} />
              </div>
              <div className="settings-block" data-block-match={matchesQuery(query, 'segmentação unidades pedaços divisão')}>
                <SegmentationSettings vaultPath={vaultPath} />
              </div>
              <div className="settings-block" data-block-match={matchesQuery(query, 'notificações lembrete aviso revisão pendente')}>
                <ReviewNotificationSettings
                  lastCheck={notificationLastCheck}
                  onRequestCheck={onCheckReviewNotifications}
                />
              </div>
            </SettingSection>

            <SettingSection
              id="ia"
              title="IA da revisão"
              description="Onde a revisão com IA roda, com chaves e consentimentos. Ollama local não envia nada para fora do computador."
              keywords="gemini ollama openai chave api consentimento provedor modelo"
            >
              <div className="settings-block" data-block-match={matchesQuery(query, 'ia inteligência artificial gemini ollama provedor chave api modelo')}>
                <ReviewAiSettings vaultPath={vaultPath} />
              </div>
            </SettingSection>

            <SettingSection
              id="sistema"
              title="Sistema"
              keywords="versão atualização update conta login assinatura"
            >
              {accountClient ? <AccountSettings client={accountClient} onOpenAccount={onOpenAccount} /> : null}

              <SettingRow
                label="Versão do MirrorMind"
                description={appVersion ? `Você está na versão ${appVersion}.` : 'Versão disponível no app desktop.'}
                keywords="atualizar update versao"
              >
                <Button
                  type="button"
                  variant="secondary" size="md"
                  onClick={() => void appUpdater.checkNow()}
                  disabled={appUpdater.status.kind === 'checking' || appUpdater.status.kind === 'downloading'}
                >
                  {appUpdater.status.kind === 'checking' ? 'Verificando…' : 'Verificar atualizações'}
                </Button>
              </SettingRow>

              {appUpdater.status.kind === 'upToDate' ? (
                <p className="settings-note" role="status">MirrorMind está atualizado.</p>
              ) : null}
              {appUpdater.status.kind === 'available' ? (
                <p className="settings-note" role="status">
                  Nova versão disponível: {appUpdater.status.update.version}. Use o aviso no canto da janela para baixar e instalar.
                </p>
              ) : null}
              {appUpdater.status.kind === 'failed' ? (
                <p className="settings-note" role="status">{appUpdater.status.message}</p>
              ) : null}

              <SettingRow
                label="Verificação automática de atualizações"
                description="Ao abrir, consulta o GitHub Releases (envia IP). Desative para não fazer nenhuma conexão automática (LGPD Art.9)."
                keywords="update github ip lgpd privacidade"
                changed={changed.autoUpdate}
                onReset={() => onToggleAutoUpdate(true)}
              >
                <input
                  type="checkbox"
                  checked={autoUpdateEnabled}
                  onChange={(event) => onToggleAutoUpdate(event.target.checked)}
                  aria-label="Verificação automática de atualizações"
                />
              </SettingRow>
            </SettingSection>

            <SettingSection
              id="dados"
              title="Dados"
              description="O que fica neste computador. Suas notas e pastas nunca são tocadas por aqui."
              keywords="apagar limpar privacidade cache chaves histórico recentes"
              tone="danger"
            >
              <div className="settings-danger">
                <div className="settings-danger-head">
                  <div className="settings-danger-text">
                    <strong>Apagar dados locais do app</strong>
                    <p>Histórico de pastas recentes, chaves dos provedores de IA e preferências locais.</p>
                  </div>
                  <Button
                    type="button"
                    variant="danger"
                    size="md"
                    className="settings-danger-open"
                    onClick={() => setClearOpen(true)}
                    disabled={clearBusy}
                  >
                    Apagar dados locais
                  </Button>
                </div>

                {clearStatus?.kind === 'ok' ? (
                  <p className="settings-note" role="status">{clearStatus.message}</p>
                ) : null}
              </div>

              {/* Confirmacao em modal: a lista do que some nao cabe numa linha e
                  o botao que apaga nao pode estar a um clique do gatilho. */}
              <Modal
                open={clearOpen}
                onClose={() => setClearOpen(false)}
                labelledBy="settings-danger-title"
                className="settings-danger-modal"
                builderName="settings-danger-modal"
                busy={clearBusy}
              >
                <h2 id="settings-danger-title">Apagar estes dados deste computador?</h2>
                <ul className="settings-danger-list">
                  <li>Histórico de pastas e notas recentes</li>
                  <li>Chaves de acesso dos provedores de IA (cofre do sistema)</li>
                  <li>Preferências locais — aparência, atalhos e orçamento de IA</li>
                </ul>
                <p className="settings-danger-keep">Suas notas, pastas e anexos do Vault não são tocados.</p>
                {clearStatus?.kind === 'error' ? (
                  <p className="field-error" role="alert">{clearStatus.message}</p>
                ) : null}
                <div className="settings-danger-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    disabled={clearBusy}
                    onClick={() => setClearOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="md"
                    disabled={clearBusy}
                    onClick={() => void clearLocalData()}
                  >
                    {clearBusy ? 'Apagando…' : 'Apagar de vez'}
                  </Button>
                </div>
              </Modal>
            </SettingSection>
          </div>
        </SettingsSearchContext.Provider>
      </div>
    </section>
  )
}
