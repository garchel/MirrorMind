import { useMemo, type Dispatch, type SetStateAction } from 'react'
import {
  Download,
  Eye,
  Folder,
  Hash,
  Info,
  Link2,
  ListFilter,
  Orbit,
  Palette,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react'
import type { TagIndex } from '../lib/tagIndex'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { GraphFilterSelect } from './GraphFilterSelect'
import './GraphToolbar.css'

/** Modo do grafo (global ou local). Centralizado aqui: a barra e o App
 * compartilham o mesmo tipo. */
export type GraphMode = 'global' | 'local'

/** Barra superior da pagina de grafos: dimensao 2D/3D, modo, filtros por
 * pasta/tag, busca, zoom, atualizacao, exportacao e configuracoes. Extraida
 * do App (era um bloco inline sem nome) — nenhum comportamento mudou, todas
 * as props espelham o estado do App. */
export type GraphToolbarProps = {
  visible: boolean
  onHoverStart: () => void
  onHoverEnd: () => void
  graphMode3d: boolean
  setGraphMode3d: Dispatch<SetStateAction<boolean>>
  graphMode: GraphMode
  setGraphMode: Dispatch<SetStateAction<GraphMode>>
  graphLocalDepth: number
  setGraphLocalDepth: Dispatch<SetStateAction<number>>
  graphFolder: string
  setGraphFolder: Dispatch<SetStateAction<string>>
  graphFolders: string[]
  graphTag: string
  setGraphTag: Dispatch<SetStateAction<string>>
  graphTags: string[]
  graphFilterActive: boolean
  graphFilterMatchPaths: Set<string> | null
  graphQuery: string
  setGraphQuery: Dispatch<SetStateAction<string>>
  setGraphViewport: Dispatch<SetStateAction<{ scale: number; x: number; y: number }>>
  resetGraphView: () => void
  openGraphPage: () => unknown
  isGraphLoading: boolean
  graphExportOpen: boolean
  setGraphExportOpen: Dispatch<SetStateAction<boolean>>
  graphExportScale: number
  setGraphExportScale: (next: number) => void
  handleGraphExport: (format: 'svg' | 'png') => unknown
  graphSettingsOpen: boolean
  setGraphSettingsOpenSynced: (open: boolean) => void
  resetGraph3dSettings: () => void
  graph3dNodeSize: number
  setGraph3dNodeSize: (next: number) => void
  graph3dDegreeGrowth: number
  setGraph3dDegreeGrowth: (next: number) => void
  graph3dNodeSpacing: number
  setGraph3dNodeSpacing: (next: number) => void
  graph3dOrbitSpeed: number
  setGraph3dOrbitSpeed: (next: number) => void
  graph3dMaxEdgeLength: number
  setGraph3dMaxEdgeLength: (next: number) => void
  graph3dMinEdgeLength: number
  setGraph3dMinEdgeLength: (next: number) => void
  graph2dRepulsionStrength: number
  setGraph2dRepulsionStrength: (next: number) => void
  graph2dLinkStiffness: number
  setGraph2dLinkStiffness: (next: number) => void
  graph2dVelocityDecay: number
  setGraph2dVelocityDecay: (next: number) => void
  graph2dLinkDistance: number
  setGraph2dLinkDistance: (next: number) => void
  graph2dCenterForce: number
  setGraph2dCenterForce: (next: number) => void
  updateNumberSetting: (raw: string, current: number, min: number, max: number) => number
  showGraphOrphans: boolean
  setShowGraphOrphans: Dispatch<SetStateAction<boolean>>
  showOnlyGraphOrphans: boolean
  setShowOnlyGraphOrphans: Dispatch<SetStateAction<boolean>>
  graphHideAllNames: boolean
  setGraphHideAllNames: Dispatch<SetStateAction<boolean>>
  graphGroupByFolder: boolean
  setGraphGroupByFolder: Dispatch<SetStateAction<boolean>>
  graphGroupByTag: boolean
  setGraphGroupByTag: Dispatch<SetStateAction<boolean>>
  graphPrimaryTag: string
  setGraphPrimaryTag: Dispatch<SetStateAction<string>>
  graphTagIndexRef: { current: TagIndex }
  graphGroupMaps: { groups: { key: string; label: string; color: string }[] } | null
  graphColorOverrides: Record<string, string>
  setGraphColorOverrides: Dispatch<SetStateAction<Record<string, string>>>
  graphRenderLimit: number
  setGraphRenderLimit: (next: number) => void
}

export function GraphToolbar(props: GraphToolbarProps) {
  const {
    visible,
    onHoverStart,
    onHoverEnd,
    graphMode3d,
    setGraphMode3d,
    graphMode,
    setGraphMode,
    graphLocalDepth,
    setGraphLocalDepth,
    graphFolder,
    setGraphFolder,
    graphFolders,
    graphTag,
    setGraphTag,
    graphTags,
    graphFilterActive,
    graphFilterMatchPaths,
    graphQuery,
    setGraphQuery,
    setGraphViewport,
    resetGraphView,
    openGraphPage,
    isGraphLoading,
    graphExportOpen,
    setGraphExportOpen,
    graphExportScale,
    setGraphExportScale,
    handleGraphExport,
    graphSettingsOpen,
    setGraphSettingsOpenSynced,
    resetGraph3dSettings,
    graph3dNodeSize,
    setGraph3dNodeSize,
    graph3dDegreeGrowth,
    setGraph3dDegreeGrowth,
    graph3dNodeSpacing,
    setGraph3dNodeSpacing,
    graph3dOrbitSpeed,
    setGraph3dOrbitSpeed,
    graph3dMaxEdgeLength,
    setGraph3dMaxEdgeLength,
    graph3dMinEdgeLength,
    setGraph3dMinEdgeLength,
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
    updateNumberSetting,
    showGraphOrphans,
    setShowGraphOrphans,
    showOnlyGraphOrphans,
    setShowOnlyGraphOrphans,
    graphHideAllNames,
    setGraphHideAllNames,
    graphGroupByFolder,
    setGraphGroupByFolder,
    graphGroupByTag,
    setGraphGroupByTag,
    graphPrimaryTag,
    setGraphPrimaryTag,
    graphTagIndexRef,
    graphGroupMaps,
    graphColorOverrides,
    setGraphColorOverrides,
    graphRenderLimit,
    setGraphRenderLimit,
  } = props

  const folderOptions = useMemo(() => graphFolders.map((folder) => ({ value: folder, label: folder })), [graphFolders])
  const tagOptions = useMemo(() => graphTags.map((tag) => ({ value: tag, label: `#${tag}` })), [graphTags])

  return (
    <div
      className={`graph-immersive-header${visible ? '' : ' is-hidden'}`}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      role="toolbar"
      aria-label="Controles do grafo"
    >
      <h2 className="graph-header-title">Grafo das notas</h2>
      <span className="graph-header-sep" aria-hidden="true" />
      <div className="graph-dimension-toggle" role="radiogroup" aria-label="Dimensao do grafo">
        <button type="button" role="radio" aria-checked={!graphMode3d} className={!graphMode3d ? 'is-active' : ''} onClick={() => setGraphMode3d(false)} title="Grafo em 2D">2D</button>
        <button type="button" role="radio" aria-checked={graphMode3d} className={graphMode3d ? 'is-active' : ''} onClick={() => setGraphMode3d(true)} title="Grafo 3D com pulsos eletricos">3D</button>
      </div>
      <select value={graphMode} onChange={(event) => setGraphMode(event.target.value as GraphMode)} aria-label="Modo do grafo"><option value="global">Grafo global</option><option value="local">Grafo local</option></select>
      {graphMode === 'local' ? (
        <select value={graphLocalDepth} onChange={(event) => setGraphLocalDepth(Number(event.target.value))} aria-label="Profundidade do grafo local">
          <option value={1}>1 salto</option>
          <option value={2}>2 saltos</option>
          <option value={3}>3 saltos</option>
        </select>
      ) : null}
      <div className="graph-filter-group" role="group" aria-label="Filtro do grafo por pasta e tag">
        <ListFilter size={14} strokeWidth={1.75} aria-hidden="true" />
        <GraphFilterSelect
          label="Filtrar pasta do grafo"
          allLabel="Todas as pastas"
          icon={<Folder size={13} strokeWidth={2} aria-hidden="true" />}
          value={graphFolder}
          options={folderOptions}
          onChange={setGraphFolder}
        />
        <GraphFilterSelect
          label="Filtrar tag do grafo"
          allLabel="Todas as tags"
          icon={<Hash size={13} strokeWidth={2} aria-hidden="true" />}
          value={graphTag}
          options={tagOptions}
          onChange={setGraphTag}
        />
        <span className="graph-filter-meta" data-active={graphFilterActive ? 'true' : 'false'}>
          {graphFilterActive ? (
            <>
              <span className="graph-filter-count" role="status">{graphFilterMatchPaths?.size ?? 0} {(graphFilterMatchPaths?.size ?? 0) === 1 ? 'nota' : 'notas'}</span>
              <button type="button" className="graph-filter-clear" onClick={() => { setGraphFolder(''); setGraphTag('') }} aria-label="Limpar filtro do grafo" title="Limpar filtro">
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </button>
            </>
          ) : null}
        </span>
      </div>
      <span className="graph-header-sep" aria-hidden="true" />
      <input value={graphQuery} onChange={(event) => setGraphQuery(event.target.value)} placeholder="Buscar nota" aria-label="Buscar nota no grafo" />
      {!graphMode3d ? (
        <span className="graph-zoom-cluster" aria-label="Zoom do grafo">
          <button type="button" className="secondary-button" onClick={() => setGraphViewport((view) => ({ ...view, scale: Math.min(2.4, view.scale + 0.15) }))} aria-label="Aproximar grafo">+</button>
          <button type="button" className="secondary-button" onClick={() => setGraphViewport((view) => ({ ...view, scale: Math.max(0.55, view.scale - 0.15) }))} aria-label="Afastar grafo">−</button>
          <button type="button" className="secondary-button" onClick={resetGraphView} aria-label="Centralizar grafo">Centralizar</button>
        </span>
      ) : null}
      <span className="graph-header-sep" aria-hidden="true" />
      <button type="button" className="secondary-button graph-icon-button" onClick={() => void openGraphPage()} disabled={isGraphLoading} aria-label="Atualizar grafo">
        <RefreshCw size={15} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <Popover open={graphExportOpen} onOpenChange={setGraphExportOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="secondary-button graph-icon-button graph-export-button" aria-label="Exportar grafo" title="Exportar grafo como SVG ou PNG">
            <Download size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="graph-export-popover">
          <p className="graph-settings-header-title"><Download size={14} strokeWidth={1.75} aria-hidden="true" /><strong>Exportar grafo</strong></p>
          <label className="graph-settings-row">
            <span>Resolucao PNG<small>Multiplicador de pixels</small></span>
            <select value={graphExportScale} onChange={(event) => setGraphExportScale(Number(event.target.value))} aria-label="Resolução do PNG exportado">
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={3}>3x</option>
            </select>
          </label>
          <div className="graph-export-actions">
            <button type="button" className="secondary-button" onClick={() => handleGraphExport('svg')} aria-label="Exportar grafo como SVG">SVG</button>
            <button type="button" className="secondary-button" onClick={() => handleGraphExport('png')} aria-label="Exportar grafo como PNG">PNG</button>
          </div>
        </PopoverContent>
      </Popover>
      <Popover open={graphSettingsOpen} onOpenChange={setGraphSettingsOpenSynced}>
        <PopoverTrigger asChild>
          <button type="button" className="secondary-button graph-icon-button graph-settings-button" aria-label="Configurações do grafo" title="Configurações do grafo">
            <Settings size={15} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="graph-settings-popover">
          <header className="graph-settings-header">
            <span className="graph-settings-header-title">
              <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
              <strong>Configurações do grafo</strong>
            </span>
            <button type="button" className="graph-settings-reset" onClick={resetGraph3dSettings} title="Restaurar os valores padrao" aria-label="Restaurar os valores padrao">
              <RotateCcw size={12} strokeWidth={1.75} aria-hidden="true" />
              <span>Padroes</span>
            </button>
          </header>
          <section className="graph-settings-group" aria-label="Visual dos nos">
            <p className="graph-settings-group-title"><Palette size={12} strokeWidth={1.75} aria-hidden="true" /> Visual</p>
            <label className="graph-settings-row">
              <span>Tamanho dos nos<small>Raio base dos orbes</small></span>
              <input type="number" min={0.2} max={3} step={0.05} value={graph3dNodeSize} onChange={(event) => setGraph3dNodeSize(updateNumberSetting(event.target.value, graph3dNodeSize, 0.2, 3))} aria-label="Tamanho dos nos no grafo 3D" />
            </label>
            <label className="graph-settings-row">
              <span>Aumento por conexao<small>Crescimento do no por link</small></span>
              <input type="number" min={0} max={1} step={0.01} value={graph3dDegreeGrowth} onChange={(event) => setGraph3dDegreeGrowth(updateNumberSetting(event.target.value, graph3dDegreeGrowth, 0, 1))} aria-label="Fator de aumento por conexao no grafo 3D" />
            </label>
          </section>
          <section className="graph-settings-group" aria-label="Orbita dos nos">
            <p className="graph-settings-group-title"><Orbit size={12} strokeWidth={1.75} aria-hidden="true" /> Orbita</p>
            <label className="graph-settings-row">
              <span>Distancia entre nos<small>Raio das orbitas ao redor do nucleo</small></span>
              <input type="number" min={2} max={20} step={0.5} value={graph3dNodeSpacing} onChange={(event) => setGraph3dNodeSpacing(updateNumberSetting(event.target.value, graph3dNodeSpacing, 2, 20))} aria-label="Distancia entre nos no grafo 3D" />
            </label>
            <label className="graph-settings-row">
              <span>Velocidade de orbitacao<small>Multiplicador do giro orbital</small></span>
              <input type="number" min={0.1} max={5} step={0.1} value={graph3dOrbitSpeed} onChange={(event) => setGraph3dOrbitSpeed(updateNumberSetting(event.target.value, graph3dOrbitSpeed, 0.1, 5))} aria-label="Velocidade de orbitação no grafo 3D" />
            </label>
          </section>
          <section className="graph-settings-group" aria-label="Arestas do grafo">
            <p className="graph-settings-group-title"><Link2 size={12} strokeWidth={1.75} aria-hidden="true" /> Arestas</p>
            <label className="graph-settings-row">
              <span>Aresta maxima<small>Limite superior das conexoes</small></span>
              <input type="number" min={4} max={40} step={1} value={graph3dMaxEdgeLength} onChange={(event) => setGraph3dMaxEdgeLength(updateNumberSetting(event.target.value, graph3dMaxEdgeLength, 4, 40))} aria-label="Tamanho maximo das arestas no grafo 3D" />
            </label>
            <label className="graph-settings-row">
              <span>Aresta minima<small>Distancia minima entre conectados</small></span>
              <input type="number" min={0} max={30} step={0.5} value={graph3dMinEdgeLength} onChange={(event) => setGraph3dMinEdgeLength(updateNumberSetting(event.target.value, graph3dMinEdgeLength, 0, 30))} aria-label="Tamanho minimo das arestas no grafo 3D" />
            </label>
          </section>
          <section className="graph-settings-group" aria-label="Forcas do grafo 2D">
            <p className="graph-settings-group-title"><Zap size={12} strokeWidth={1.75} aria-hidden="true" /> Forcas (2D)</p>
            <label className="graph-settings-row">
              <span>Repulsao<small>Forca entre os nos (1/distancia²)</small></span>
              <input type="number" step={50} value={graph2dRepulsionStrength} onChange={(event) => setGraph2dRepulsionStrength(updateNumberSetting(event.target.value, graph2dRepulsionStrength, -Infinity, Infinity))} aria-label="Forca de repulsao dos nos no grafo 2D" />
            </label>
            <label className="graph-settings-row">
              <span>Rigidez da mola<small>Forca das arestas por unidade de distancia</small></span>
              <input type="number" step={0.1} value={graph2dLinkStiffness} onChange={(event) => setGraph2dLinkStiffness(updateNumberSetting(event.target.value, graph2dLinkStiffness, -Infinity, Infinity))} aria-label="Rigidez da mola das arestas no grafo 2D" />
            </label>
            <label className="graph-settings-row">
              <span>Amortecimento<small>Decaimento de velocidade por segundo</small></span>
              <input type="number" step={0.05} value={graph2dVelocityDecay} onChange={(event) => setGraph2dVelocityDecay(updateNumberSetting(event.target.value, graph2dVelocityDecay, -Infinity, Infinity))} aria-label="Amortecimento da velocidade no grafo 2D" />
            </label>
            <label className="graph-settings-row">
              <span>Distancia do link<small>Descanso das molas entre conectados</small></span>
              <input type="number" step={0.5} value={graph2dLinkDistance} onChange={(event) => setGraph2dLinkDistance(updateNumberSetting(event.target.value, graph2dLinkDistance, -Infinity, Infinity))} aria-label="Distancia do link no grafo 2D" />
            </label>
            <label className="graph-settings-row">
              <span>Forca central<small>Atracao ao anel no meio do grafo</small></span>
              <input type="number" step={5} value={graph2dCenterForce} onChange={(event) => setGraph2dCenterForce(updateNumberSetting(event.target.value, graph2dCenterForce, -Infinity, Infinity))} aria-label="Forca central do grafo 2D" />
            </label>
          </section>
          <section className="graph-settings-group" aria-label="Exibição do grafo">
            <p className="graph-settings-group-title"><Eye size={12} strokeWidth={1.75} aria-hidden="true" /> Exibicao</p>
            <label className="graph-settings-toggle">
              <span>Mostrar notas sem conexao<small>Inclui notas isoladas no grafo</small></span>
              <input type="checkbox" checked={showGraphOrphans} onChange={(event) => setShowGraphOrphans(event.target.checked)} />
              <span className="graph-settings-toggle-track" aria-hidden="true" />
            </label>
            <label className="graph-settings-toggle">
              <span>Somente notas não conectadas<small>Esconde as conectadas</small></span>
              <input type="checkbox" checked={showOnlyGraphOrphans} onChange={(event) => setShowOnlyGraphOrphans(event.target.checked)} />
              <span className="graph-settings-toggle-track" aria-hidden="true" />
            </label>
            <label className="graph-settings-toggle">
              <span>Ocultar nomes<small>Nome aparece apenas no hover</small></span>
              <input type="checkbox" checked={graphHideAllNames} onChange={(event) => setGraphHideAllNames(event.target.checked)} />
              <span className="graph-settings-toggle-track" aria-hidden="true" />
            </label>
            <label className="graph-settings-toggle">
              <span>Agrupar por pasta<small>Clusters e cores por pasta com legenda</small></span>
              <input type="checkbox" checked={graphGroupByFolder} onChange={(event) => setGraphGroupByFolder(event.target.checked)} aria-label="Agrupar por pasta" />
              <span className="graph-settings-toggle-track" aria-hidden="true" />
            </label>
            <label className="graph-settings-toggle">
              <span>Agrupar por tag<small>Clusters e cores pela tag principal com legenda</small></span>
              <input type="checkbox" checked={graphGroupByTag} onChange={(event) => setGraphGroupByTag(event.target.checked)} aria-label="Agrupar por tag" />
              <span className="graph-settings-toggle-track" aria-hidden="true" />
            </label>
            {graphGroupByTag ? (
              <label className="graph-settings-row">
                <span>Tag principal<small>Usada para desempatar notas com varias tags</small></span>
                <select
                  value={graphPrimaryTag}
                  onChange={(event) => setGraphPrimaryTag(event.target.value)}
                  aria-label="Tag principal do agrupamento por tag"
                >
                  <option value="">Primeira tag da nota</option>
                  {graphTagIndexRef.current.allTags().map((tag) => (
                    <option key={tag} value={tag}>#{tag}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {graphGroupMaps ? (
              <section className="graph-settings-colors" aria-label="Cores dos grupos">
                <p className="graph-settings-colors-title"><Palette size={12} strokeWidth={1.75} aria-hidden="true" /> Cores dos grupos</p>
                {graphGroupMaps.groups.slice(0, 12).map((group) => {
                  const override = graphColorOverrides[group.key]
                  return (
                    <label key={group.key} className="graph-settings-color-row">
                      <input
                        type="color"
                        value={override && /^#[0-9a-fA-F]{6}$/.test(override) ? override : group.color}
                        onChange={(event) => setGraphColorOverrides((current) => ({ ...current, [group.key]: event.target.value }))}
                        aria-label={`Cor do grupo ${group.label}`}
                      />
                      <span className="graph-settings-color-label" title={group.label}>{group.label}</span>
                      {override ? (
                        <button
                          type="button"
                          className="graph-settings-color-reset"
                          onClick={() => setGraphColorOverrides((current) => {
                            const next = { ...current }
                            delete next[group.key]
                            return next
                          })}
                          aria-label={`Restaurar cor padrao do grupo ${group.label}`}
                        >Restaurar</button>
                      ) : null}
                    </label>
                  )
                })}
                {Object.keys(graphColorOverrides).length > 0 ? (
                  <button
                    type="button"
                    className="graph-settings-color-reset-all"
                    onClick={() => setGraphColorOverrides({})}
                  >Restaurar todas as cores</button>
                ) : null}
              </section>
            ) : null}
            <label className="graph-settings-row">
              <span>Limite de nos renderizados<small>Acima dele, so o viewport e o contexto aparecem</small></span>
              <input type="number" min={50} max={10000} step={50} value={graphRenderLimit} onChange={(event) => setGraphRenderLimit(updateNumberSetting(event.target.value, graphRenderLimit, 50, 10000))} aria-label="Limite de nos renderizados no grafo 2D" />
            </label>
          </section>
          <p className="graph-settings-note"><Info size={12} strokeWidth={1.75} aria-hidden="true" /> Sincronizado com a pagina de Configurações.</p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
