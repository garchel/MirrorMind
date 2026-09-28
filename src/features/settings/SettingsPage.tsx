import type { RefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_HISTORY_LIMIT,
  FONT_FAMILIES,
  MAX_FONT_SIZE,
  MAX_HISTORY_LIMIT,
  MIN_FONT_SIZE,
  MIN_HISTORY_LIMIT,
  THEME_MODES,
  clampFontSize,
  clampHistoryLimit,
  type EditorFontFamily,
} from '../../lib/appearance'
import { formatShortcut } from '../../lib/keyboard-shortcuts'
import type {
  ReadingFont,
  ReadingWidth,
  useAppearanceSettings,
} from '../../lib/useAppearanceSettings'
import type { useGraphSettings } from '../../lib/useGraphSettings'
import type { ObsidianAppearance } from '../../lib/vault'
import type { AppUpdaterController } from '../../lib/useAppUpdater'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSectionId } from './useSettingsNav'
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
export type ReviewGapMode = 'always' | 'hover' | 'off'

/** Página de Configurações extraída do `App.tsx`: mesmos nomes de estado
 * (via `appearance`/`graph`), mesmos textos, mesmos comportamentos. O App
 * continua dono dos hooks e passa os valores; a navegação entre seções vem
 * do `useSettingsNav` (também no App, para o scrollspy engatar ao abrir). */
export type SettingsPageProps = {
  vaultPath: string
  obsidianAppearance: ObsidianAppearance | null
  appearance: ReturnType<typeof useAppearanceSettings>
  graph: ReturnType<typeof useGraphSettings>
  reviewGapMode: ReviewGapMode
  setReviewGapMode: (mode: ReviewGapMode) => void
  notificationLastCheck: ReviewNotificationCheck | null
  onCheckReviewNotifications: () => void
  appVersion: string | null
  appUpdater: AppUpdaterController
  autoUpdateEnabled: boolean
  onToggleAutoUpdate: (enabled: boolean) => void
  updateNumberSetting: (raw: string, current: number, min: number, max: number) => number
  activeSettingsSection: SettingsSectionId
  onNavigateSettingsSection: (sectionId: SettingsSectionId) => void
  settingsScrollRef: RefObject<HTMLElement | null>
  /** Cliente de conta (null = seção oculta; App injeta quando a cobrança liga). */
  accountClient: SessionClient | null
}

export function SettingsPage({
  vaultPath,
  obsidianAppearance,
  appearance,
  graph,
  reviewGapMode,
  setReviewGapMode,
  notificationLastCheck,
  onCheckReviewNotifications,
  appVersion,
  appUpdater,
  autoUpdateEnabled,
  onToggleAutoUpdate,
  updateNumberSetting,
  activeSettingsSection,
  onNavigateSettingsSection,
  settingsScrollRef,
  accountClient,
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
  const {
    graph3dNodeSize,
    setGraph3dNodeSize,
    graph3dNodeSpacing,
    setGraph3dNodeSpacing,
    graph3dOrbitSpeed,
    setGraph3dOrbitSpeed,
    graph3dMaxEdgeLength,
    setGraph3dMaxEdgeLength,
    graph3dMinEdgeLength,
    setGraph3dMinEdgeLength,
    graph3dDegreeGrowth,
    setGraph3dDegreeGrowth,
    graph2dRepulsionStrength,
    setGraph2dRepulsionStrength,
    graph2dLinkStiffness,
    setGraph2dLinkStiffness,
    graph2dVelocityDecay,
    setGraph2dVelocityDecay,
    graph2dLinkDistance,
    setGraph2dLinkDistance,
    graph2dCenterForce,
    setGraph2dCenterForce,
  } = graph

  return (
    <section ref={settingsScrollRef} className="workspace-page" data-builder-name="settings-page">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Seções das configurações">
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.id} className="settings-nav-group" role="group" aria-label={group.label}>
              <p className="settings-nav-group-label" aria-hidden="true">{group.label}</p>
              {SETTINGS_SECTIONS
                .filter((section) => (group.sections as readonly string[]).includes(section.id))
                .map((section) => (
                  <button
                    key={section.id}
                    type="button"
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
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          <p className="card-kicker">Configurações</p>
          <h2>Configurações do vault</h2>
          <p>Personalize a escrita, a leitura e o comportamento do workspace.</p>
          <div className="settings-section" id="settings-aparencia" aria-labelledby="appearance-preferences-title">
            <p className="card-kicker" id="appearance-preferences-title">Aparência</p>
            <div className="settings-toggle">
              <span>
                <strong>Tema</strong>
                <small>Escuro aplica contraste noturno em toda a interface. Seguir Obsidian importa o tema do `appearance.json` sem sobrescrever o `.obsidian`.</small>
              </span>
              <div className="settings-segmented" role="radiogroup" aria-label="Tema da interface">
                {THEME_MODES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={themeMode === option.value}
                    className={themeMode === option.value ? 'is-active' : ''}
                    onClick={() => setThemeMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-toggle">
              <span>
                <strong>Largura das páginas</strong>
                <small>Com espaçamento mantém o respiro padrão em todas as páginas. Largura total ocupa 100% do espaço disponível.</small>
              </span>
              <div className="settings-segmented" role="radiogroup" aria-label="Largura das páginas">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!isPagesFullWidth}
                  className={!isPagesFullWidth ? 'is-active' : ''}
                  onClick={() => setPagesFullWidth(false)}
                >
                  Com espaçamento
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isPagesFullWidth}
                  className={isPagesFullWidth ? 'is-active' : ''}
                  onClick={() => setPagesFullWidth(true)}
                >
                  Largura total
                </button>
              </div>
            </div>
            <label className="settings-toggle">
              <span>
                <strong>Fonte do editor e da leitura</strong>
                <small>Familia aplicada aos modos Edicao, Misto e Leitura.</small>
              </span>
              <select className="settings-select" value={editorFontFamily} onChange={(event) => setEditorFontFamily(event.target.value as EditorFontFamily)} aria-label="Familia da fonte do editor e da leitura">
                {FONT_FAMILIES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Tamanho da fonte</strong>
                <small>Medida base do texto do editor e da leitura em pixels.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                min={MIN_FONT_SIZE}
                max={MAX_FONT_SIZE}
                step={1}
                value={editorFontSize}
                onChange={(event) => setEditorFontSize(clampFontSize(Number(event.target.value)))}
                aria-label="Tamanho da fonte do editor e da leitura"
              />
            </label>
            {obsidianAppearance?.baseFontSize ? (
              <label className="settings-toggle">
                <span>
                  <strong>Tamanho do Obsidian</strong>
                  <small>O Vault declara baseFontSize de {Math.round(obsidianAppearance.baseFontSize)}px. Aplica sem alterar o `.obsidian`.</small>
                </span>
                <button type="button" className="secondary-button" onClick={() => setEditorFontSize(clampFontSize(obsidianAppearance?.baseFontSize ?? DEFAULT_FONT_SIZE))}>Usar tamanho do Obsidian</button>
              </label>
            ) : null}
            <label className="settings-toggle">
              <span>
                <strong>Limite do historico</strong>
                <small>Acoes de desfazer/refazer mantidas por nota no editor ({DEFAULT_HISTORY_LIMIT} por padrao).</small>
              </span>
              <input
                className="settings-number"
                type="number"
                min={MIN_HISTORY_LIMIT}
                max={MAX_HISTORY_LIMIT}
                step={5}
                value={historyLimit}
                onChange={(event) => setHistoryLimit(clampHistoryLimit(Number(event.target.value)))}
                aria-label="Limite do histórico de desfazer e refazer"
              />
            </label>
            {obsidianAppearance?.ignoredAppearanceFields.length ? (
              <p className="settings-note" role="status">
                {obsidianAppearance.ignoredAppearanceFields.length} campo(s) de `appearance.json` com tipo invalido foram ignorados sem descartar os demais.
              </p>
            ) : null}
          </div>
          <div className="settings-section" id="settings-workspace" aria-labelledby="workspace-preferences-title">
            <p className="card-kicker" id="workspace-preferences-title">Workspace</p>
            <label className="settings-toggle">
              <span>
                <strong>Auto Save</strong>
              <small>Salva apos uma breve pausa na digitacao, sem interromper a edicao.</small>
            </span>
            <input
              type="checkbox"
              checked={isAutoSaveEnabled}
              onChange={(event) => setAutoSaveEnabled(event.target.checked)}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Cor do hover das notas</strong>
              <small>Define a cor de fundo ao passar o mouse sobre uma nota no explorador.</small>
            </span>
            <input
              type="color"
              value={noteHoverColor}
              onChange={(event) => setNoteHoverColor(event.target.value)}
              aria-label="Cor do hover das notas"
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Cor do hover das abas</strong>
              <small>Define a cor de fundo ao passar o mouse por uma aba aberta.</small>
            </span>
            <input
              type="color"
              value={tabHoverColor}
              onChange={(event) => setTabHoverColor(event.target.value)}
              aria-label="Cor do hover das abas"
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>Cor do texto no hover das abas</strong>
              <small>Define a cor do título e do icone de fechar enquanto uma aba esta em hover.</small>
            </span>
            <input
              type="color"
              value={tabHoverTextColor}
              onChange={(event) => setTabHoverTextColor(event.target.value)}
              aria-label="Cor do texto no hover das abas"
            />
          </label>
          </div>
          <div className="settings-section" id="settings-leitura" aria-labelledby="reading-preferences-title">
            <p className="card-kicker" id="reading-preferences-title">Leitura</p>
            <label className="settings-toggle">
              <span>
                <strong>Fonte de leitura</strong>
                <small>Aplica a familia tipografica escolhida no modo Leitura.</small>
              </span>
              <select className="settings-select" value={readingFont} onChange={(event) => setReadingFont(event.target.value as ReadingFont)} aria-label="Fonte de leitura">
                <option value="sans">Sans serif</option>
                <option value="serif">Serif</option>
                <option value="mono">Monoespacada</option>
              </select>
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Largura da leitura</strong>
                <small>Controla a medida da coluna de conteudo no modo Leitura.</small>
              </span>
              <select className="settings-select" value={readingWidth} onChange={(event) => setReadingWidth(event.target.value as ReadingWidth)} aria-label="Largura da leitura">
                <option value="compact">Compacta</option>
                <option value="comfortable">Confortavel</option>
                <option value="wide">Ampla</option>
              </select>
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Quebra de linha</strong>
                <small>Desative para manter linhas longas em uma unica linha no modo Leitura.</small>
              </span>
              <input type="checkbox" checked={isReadingLineWrapEnabled} onChange={(event) => setReadingLineWrapEnabled(event.target.checked)} />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Corretor ortografico</strong>
                <small>Usa o corretor nativo do sistema nos modos Edicao e Misto.</small>
              </span>
              <input type="checkbox" checked={isSpellCheckEnabled} onChange={(event) => setSpellCheckEnabled(event.target.checked)} />
            </label>
          </div>
          <div className="settings-section" id="settings-atalhos" aria-labelledby="shortcuts-preferences-title">
            <p className="card-kicker" id="shortcuts-preferences-title">Atalhos</p>
            <p className="settings-section-description">Selecione um campo e pressione a nova combinacao de teclas.</p>
            <div className="shortcut-settings">
              <label>
                <span>
                  <strong>Criar nova nota</strong>
                  <small>Abre a captura de uma nova nota no explorador.</small>
                </span>
                <input
                  value={shortcuts.createNote}
                  onKeyDown={(event) => {
                    event.preventDefault()
                    patchShortcuts({ createNote: formatShortcut(event.nativeEvent) })
                  }}
                  aria-label="Atalho para criar nova nota"
                  readOnly
                />
              </label>
              <label>
                <span>
                  <strong>Salvar nota</strong>
                  <small>Salva as alteracoes da nota aberta.</small>
                </span>
                <input
                  value={shortcuts.saveNote}
                  onKeyDown={(event) => {
                    event.preventDefault()
                    patchShortcuts({ saveNote: formatShortcut(event.nativeEvent) })
                  }}
                  aria-label="Atalho para salvar nota"
                  readOnly
                />
              </label>
              <label>
                <span>
                  <strong>Alternar modo de visualizacao</strong>
                  <small>Alterna entre os modos Misto, Edicao e Leitura.</small>
                </span>
                <input
                  value={shortcuts.cycleNoteViewMode}
                  onKeyDown={(event) => {
                    event.preventDefault()
                    patchShortcuts({ cycleNoteViewMode: formatShortcut(event.nativeEvent) })
                  }}
                  aria-label="Atalho para alternar modo de visualização"
                  readOnly
                />
              </label>
              <label>
                <span>
                  <strong>Abrir nota existente</strong>
                  <small>Abre a busca rapida de notas do vault.</small>
                </span>
                <input
                  value={shortcuts.openNote}
                  onKeyDown={(event) => {
                    event.preventDefault()
                    patchShortcuts({ openNote: formatShortcut(event.nativeEvent) })
                  }}
                  aria-label="Atalho para abrir nota existente"
                  readOnly
                />
              </label>
              <label>
                <span>
                  <strong>Abrir filtro de tags</strong>
                  <small>Abre o filtro completo de tags do explorador.</small>
                </span>
                <input
                  value={shortcuts.openTagFilter}
                  onKeyDown={(event) => {
                    event.preventDefault()
                    patchShortcuts({ openTagFilter: formatShortcut(event.nativeEvent) })
                  }}
                  aria-label="Atalho para abrir filtro de tags"
                  readOnly
                />
              </label>
              <label>
                <span>
                  <strong>Abrir Command Palette</strong>
                  <small>Abre a busca de comandos do workspace.</small>
                </span>
                <input
                  value={shortcuts.openCommandPalette}
                  onKeyDown={(event) => {
                    event.preventDefault()
                    patchShortcuts({ openCommandPalette: formatShortcut(event.nativeEvent) })
                  }}
                  aria-label="Atalho para abrir Command Palette"
                  readOnly
                />
              </label>
            </div>
            <div>
              <button type="button" className="secondary-button" onClick={resetShortcuts}>
                Restaurar padroes
              </button>
            </div>
          </div>
          <div className="settings-section" id="settings-grafo3d" aria-labelledby="graph3d-preferences-title">
            <p className="card-kicker" id="graph3d-preferences-title">Grafo 3D</p>
            <label className="settings-toggle">
              <span>
                <strong>Tamanho dos nos</strong>
                <small>Raio base dos orbes 3D no grafo.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                min={0.2}
                max={3}
                step={0.05}
                value={graph3dNodeSize}
                onChange={(event) => setGraph3dNodeSize(updateNumberSetting(event.target.value, graph3dNodeSize, 0.2, 3))}
                aria-label="Tamanho dos nos no grafo 3D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Distancia entre nos</strong>
                <small>Raio das orbitas dos eletrons ao redor do elemento com mais conexoes.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                min={2}
                max={20}
                step={0.5}
                value={graph3dNodeSpacing}
                onChange={(event) => setGraph3dNodeSpacing(updateNumberSetting(event.target.value, graph3dNodeSpacing, 2, 20))}
                aria-label="Distancia entre nos no grafo 3D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Velocidade de orbitacao</strong>
                <small>Multiplicador da velocidade com que os eletrons orbitam o nucleo.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                value={graph3dOrbitSpeed}
                onChange={(event) => setGraph3dOrbitSpeed(updateNumberSetting(event.target.value, graph3dOrbitSpeed, 0.1, 5))}
                aria-label="Velocidade de orbitação no grafo 3D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Tamanho maximo das arestas</strong>
                <small>Distancia maxima entre nos conectados; alem dela, a aresta puxa os extremos de volta.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                min={4}
                max={40}
                step={1}
                value={graph3dMaxEdgeLength}
                onChange={(event) => setGraph3dMaxEdgeLength(updateNumberSetting(event.target.value, graph3dMaxEdgeLength, 4, 40))}
                aria-label="Tamanho maximo das arestas no grafo 3D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Tamanho minimo das arestas</strong>
                <small>Distancia minima entre nos conectados; abaixo dela, a aresta empurra os extremos para longe.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={graph3dMinEdgeLength}
                onChange={(event) => setGraph3dMinEdgeLength(updateNumberSetting(event.target.value, graph3dMinEdgeLength, 0, 30))}
                aria-label="Tamanho minimo das arestas no grafo 3D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Fator de aumento por conexao</strong>
                <small>Quanto cada conexao adicional aumenta o raio do no.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={graph3dDegreeGrowth}
                onChange={(event) => setGraph3dDegreeGrowth(updateNumberSetting(event.target.value, graph3dDegreeGrowth, 0, 1))}
                aria-label="Fator de aumento por conexao no grafo 3D"
              />
            </label>
          </div>
          <div className="settings-section" id="settings-grafo2d" aria-labelledby="graph2d-preferences-title">
            <p className="card-kicker" id="graph2d-preferences-title">Grafo 2D</p>
            <p className="settings-section-description">Forcas da simulacao do grafo 2D, no modelo do Obsidian: repulsao 1/distancia² entre nos, molas das arestas (rigidez e descanso), amortecimento da velocidade e atracao ao anel central.</p>
            <label className="settings-toggle">
              <span>
                <strong>Repulsao</strong>
                <small>Forca com que os nos se repelem entre si (inversa ao quadrado da distancia).</small>
              </span>
              <input
                className="settings-number"
                type="number"
                step={50}
                value={graph2dRepulsionStrength}
                onChange={(event) => setGraph2dRepulsionStrength(updateNumberSetting(event.target.value, graph2dRepulsionStrength, -Infinity, Infinity))}
                aria-label="Forca de repulsao dos nos no grafo 2D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Rigidez da mola</strong>
                <small>Forca das arestas por unidade de distancia alem do descanso.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                step={0.1}
                value={graph2dLinkStiffness}
                onChange={(event) => setGraph2dLinkStiffness(updateNumberSetting(event.target.value, graph2dLinkStiffness, -Infinity, Infinity))}
                aria-label="Rigidez da mola das arestas no grafo 2D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Amortecimento</strong>
                <small>Decaimento da velocidade por segundo; mais alto = movimento mais "gredoso".</small>
              </span>
              <input
                className="settings-number"
                type="number"
                step={0.05}
                value={graph2dVelocityDecay}
                onChange={(event) => setGraph2dVelocityDecay(updateNumberSetting(event.target.value, graph2dVelocityDecay, -Infinity, Infinity))}
                aria-label="Amortecimento da velocidade no grafo 2D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Distancia do link</strong>
                <small>Comprimento de descanso das molas entre nos conectados.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                step={0.5}
                value={graph2dLinkDistance}
                onChange={(event) => setGraph2dLinkDistance(updateNumberSetting(event.target.value, graph2dLinkDistance, -Infinity, Infinity))}
                aria-label="Distancia do link no grafo 2D"
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>Forca central</strong>
                <small>Atracao ao anel no meio do grafo; nos dentro do anel ficam soltos.</small>
              </span>
              <input
                className="settings-number"
                type="number"
                step={5}
                value={graph2dCenterForce}
                onChange={(event) => setGraph2dCenterForce(updateNumberSetting(event.target.value, graph2dCenterForce, -Infinity, Infinity))}
                aria-label="Forca central do grafo 2D"
              />
            </label>
          </div>
          <div className="settings-section" id="settings-revisao" aria-labelledby="review-gap-preferences-title">
            <p className="card-kicker" id="review-gap-preferences-title">Revisão</p>
            <label className="settings-toggle">
              <span>
                <strong>Lacunas da ultima revisao no editor</strong>
                <small>Como destacar os trechos esquecidos ou confundidos na nota, usando o resultado mais recente. O Markdown nunca e modificado.</small>
              </span>
              <select
                className="settings-select"
                value={reviewGapMode}
                onChange={(event) => setReviewGapMode(event.target.value as ReviewGapMode)}
                aria-label="Exibição das lacunas da última revisão"
              >
                <option value="always">Revisão (sempre visíveis)</option>
                <option value="hover">Misto (somente no hover)</option>
                <option value="off">Minhas cores (desativadas)</option>
              </select>
            </label>
            <VaultReviewPolicySettings vaultPath={vaultPath} />
            <SegmentationSettings vaultPath={vaultPath} />
            <ReviewNotificationSettings
              lastCheck={notificationLastCheck}
              onRequestCheck={onCheckReviewNotifications}
            />
          </div>
          <div className="settings-section" id="settings-aplicativo" aria-labelledby="app-preferences-title">
            <p className="card-kicker" id="app-preferences-title">Aplicativo</p>
            {accountClient ? <AccountSettings client={accountClient} /> : null}
            <div className="settings-toggle">
              <span>
                <strong>Versão do MirrorMind</strong>
                <small>{appVersion ? `Você está na versão ${appVersion}.` : 'Versão disponível no app desktop.'}</small>
              </span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void appUpdater.checkNow()}
                disabled={appUpdater.status.kind === 'checking' || appUpdater.status.kind === 'downloading'}
              >
                {appUpdater.status.kind === 'checking' ? 'Verificando…' : 'Verificar atualizações'}
              </button>
            </div>
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
            <label className="settings-toggle" style={{ marginTop: 12 }}>
              <span>
                <strong>Verificação automática de atualizações</strong>
                <small>Ao abrir, consulta o GitHub Releases (envia IP). Desative para não fazer nenhuma conexão automática (LGPD Art.9).</small>
              </span>
              <input
                type="checkbox"
                checked={autoUpdateEnabled}
                onChange={(event) => onToggleAutoUpdate(event.target.checked)}
                aria-label="Verificação automática de atualizações"
              />
            </label>
            <div className="settings-toggle" style={{ marginTop: 12 }}>
              <span>
                <strong>Privacidade — Apagar dados locais</strong>
                <small>Remove recent-vault.json, chaves do cofre (Gemini/OpenAI) e preferências locais (LGPD Art.18 VI). Vaults e notas NÃO são apagados.</small>
              </span>
              <button
                type="button"
                className="secondary-button danger-button"
                onClick={async () => {
                  if (!confirm('Apagar dados locais do MirrorMind? Isso limpa recent-vault.json, chaves do cofre e localStorage (preferências). Vaults e notas serão preservados.')) return
                  try {
                    await invoke('clear_local_app_data')
                    localStorage.clear()
                    alert('Dados locais apagados. Reinicie o app.')
                  } catch (e) {
                    alert(errorMessage(e, String(e)))
                  }
                }}
              >
                Apagar dados locais
              </button>
            </div>
          </div>
          <div className="settings-section" id="settings-provedor-ia" aria-labelledby="ai-provider-preferences-title">
            <p className="card-kicker" id="ai-provider-preferences-title">Provedor de IA</p>
            <p className="settings-section-description">Onde a revisão com IA roda, com chaves e consentimentos. Ollama local não envia nada para fora do computador.</p>
            <ReviewAiSettings vaultPath={vaultPath} />
          </div>
        </div>
      </div>
    </section>
  )
}
