import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import {
  Box,
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
  resetGraph2dSettings: () => void
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
  graph2dCollideRadius: number
  setGraph2dCollideRadius: (next: number) => void
  graph2dCollideStrength: number
  setGraph2dCollideStrength: (next: number) => void
  graph2dRecentroSeconds: number
  setGraph2dRecentroSeconds: (next: number) => void
  graph2dDragAlpha: number
  setGraph2dDragAlpha: (next: number) => void
  graph2dMinEdgeLength: number
  setGraph2dMinEdgeLength: (next: number) => void
  graph2dMaxEdgeLength: number
  setGraph2dMaxEdgeLength: (next: number) => void
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
    resetGraph2dSettings,
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
    graph2dCollideRadius,
    setGraph2dCollideRadius,
    graph2dCollideStrength,
    setGraph2dCollideStrength,
    graph2dRecentroSeconds,
    setGraph2dRecentroSeconds,
    graph2dDragAlpha,
    setGraph2dDragAlpha,
    graph2dMinEdgeLength,
    setGraph2dMinEdgeLength,
    graph2dMaxEdgeLength,
    setGraph2dMaxEdgeLength,
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

  // Rolar o menu so enquanto o ponteiro (ou o foco do teclado) esta dentro
  // dele. Fora, a roda do mouse pertence ao grafo: sem isso, girar a roda
  // sobre a tela com o menu aberto ficava com metade do gesto presa no menu.
  const [settingsPointerInside, setSettingsPointerInside] = useState(false)

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
        <Button variant="bare" size="sm" role="radio" aria-checked={!graphMode3d} className={!graphMode3d ? 'is-active' : ''} onClick={() => setGraphMode3d(false)} title="Grafo em 2D">2D</Button>
        <Button variant="bare" size="sm" role="radio" aria-checked={graphMode3d} className={graphMode3d ? 'is-active' : ''} onClick={() => setGraphMode3d(true)} title="Grafo 3D com pulsos eletricos">3D</Button>
      </div>
      <Field as="select" size="sm" value={graphMode} onChange={(event) => setGraphMode(event.target.value as GraphMode)} aria-label="Modo do grafo"><option value="global">Grafo global</option><option value="local">Grafo local</option></Field>
      {graphMode === 'local' ? (
        <Field as="select" size="sm" value={graphLocalDepth} onChange={(event) => setGraphLocalDepth(Number(event.target.value))} aria-label="Profundidade do grafo local">
          <option value={1}>1 salto</option>
          <option value={2}>2 saltos</option>
          <option value={3}>3 saltos</option>
        </Field>
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
              <Button type="button" className="ui-button graph-filter-clear" onClick={() => { setGraphFolder(''); setGraphTag('') }} aria-label="Limpar filtro do grafo" title="Limpar filtro">
                <X size={12} strokeWidth={2} aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </span>
      </div>
      <span className="graph-header-sep" aria-hidden="true" />
      <Field size="sm" value={graphQuery} onChange={(event) => setGraphQuery(event.target.value)} placeholder="Buscar nota" aria-label="Buscar nota no grafo" />
      {!graphMode3d ? (
        <span className="graph-zoom-cluster" aria-label="Zoom do grafo">
          <Button type="button" variant="secondary" size="md" onClick={() => setGraphViewport((view) => ({ ...view, scale: Math.min(2.4, view.scale + 0.15) }))} aria-label="Aproximar grafo">+</Button>
          <Button type="button" variant="secondary" size="md" onClick={() => setGraphViewport((view) => ({ ...view, scale: Math.max(0.55, view.scale - 0.15) }))} aria-label="Afastar grafo">−</Button>
          <Button type="button" variant="secondary" size="md" onClick={resetGraphView} aria-label="Centralizar grafo">Centralizar</Button>
        </span>
      ) : null}
      <span className="graph-header-sep" aria-hidden="true" />
      <Button type="button" variant="secondary" size="md" className="graph-icon-button" onClick={() => void openGraphPage()} disabled={isGraphLoading} aria-label="Atualizar grafo">
        <RefreshCw size={15} strokeWidth={1.5} aria-hidden="true" />
      </Button>
      <Popover open={graphExportOpen} onOpenChange={setGraphExportOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="secondary" size="md" className="graph-icon-button graph-export-button" aria-label="Exportar grafo" title="Exportar grafo como SVG ou PNG">
            <Download size={15} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="graph-export-popover">
          <p className="graph-settings-header-title"><Download size={14} strokeWidth={1.75} aria-hidden="true" /><strong>Exportar grafo</strong></p>
          <label className="graph-settings-row">
            <span>Resolucao PNG<small>Multiplicador de pixels</small></span>
            <Field as="select" size="xs" value={graphExportScale} onChange={(event) => setGraphExportScale(Number(event.target.value))} aria-label="Resolução do PNG exportado">
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={3}>3x</option>
            </Field>
          </label>
          <div className="graph-export-actions">
            <Button type="button" variant="secondary" size="md" onClick={() => handleGraphExport('svg')} aria-label="Exportar grafo como SVG">SVG</Button>
            <Button type="button" variant="secondary" size="md" onClick={() => handleGraphExport('png')} aria-label="Exportar grafo como PNG">PNG</Button>
          </div>
        </PopoverContent>
      </Popover>
      <Popover open={graphSettingsOpen} onOpenChange={setGraphSettingsOpenSynced}>
        <PopoverTrigger asChild>
          <Button type="button" variant="secondary" size="md" className="graph-icon-button graph-settings-button" aria-label="Configurações do grafo" title="Configurações do grafo">
            <Settings size={15} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className={`graph-settings-popover${settingsPointerInside ? ' is-pointer-inside' : ''}`}
          onPointerEnter={() => setSettingsPointerInside(true)}
          onPointerLeave={() => setSettingsPointerInside(false)}
        >
          <header className="graph-settings-header">
            <span className="graph-settings-header-title">
              <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden="true" />
              <strong>Configurações do grafo</strong>
            </span>
            <Button type="button" className="ui-button graph-settings-reset" onClick={() => { resetGraph3dSettings(); resetGraph2dSettings() }} title="Restaurar os valores padrão de 2D e 3D" aria-label="Restaurar os valores padrão">
              <RotateCcw size={12} strokeWidth={1.75} aria-hidden="true" />
              <span>Padroes</span>
            </Button>
          </header>

          {/* ---------- 3D: aparece so no modo 3D ---------- */}
          {graphMode3d ? (
          <section className="graph-settings-mode" aria-labelledby="graph-settings-modo-3d">
            <p className="graph-settings-mode-head" id="graph-settings-modo-3d">
              <span className="graph-settings-mode-name"><Box size={12} strokeWidth={1.75} aria-hidden="true" /> Grafo 3D</span>
            </p>
            <section className="graph-settings-group" aria-label="Visual dos nós">
              <p className="graph-settings-group-title"><Palette size={12} strokeWidth={1.75} aria-hidden="true" /> Visual</p>
              <label className="graph-settings-row">
                <span>Tamanho dos nós<small>Raio base dos orbes</small></span>
                <Field type="number" size="xs" min={0.2} max={3} step={0.05} value={graph3dNodeSize} onChange={(event) => setGraph3dNodeSize(updateNumberSetting(event.target.value, graph3dNodeSize, 0.2, 3))} aria-label="Tamanho dos nós no grafo 3D" />
              </label>
              <label className="graph-settings-row">
                <span>Aumento por conexão<small>Crescimento do nó por link</small></span>
                <Field type="number" size="xs" min={0} max={1} step={0.01} value={graph3dDegreeGrowth} onChange={(event) => setGraph3dDegreeGrowth(updateNumberSetting(event.target.value, graph3dDegreeGrowth, 0, 1))} aria-label="Fator de aumento por conexão no grafo 3D" />
              </label>
            </section>
            <section className="graph-settings-group" aria-label="Órbita dos nós">
              <p className="graph-settings-group-title"><Orbit size={12} strokeWidth={1.75} aria-hidden="true" /> Orbita</p>
              <label className="graph-settings-row">
                <span>Distância entre nós<small>Raio das órbitas ao redor do núcleo</small></span>
                <Field type="number" size="xs" min={2} max={20} step={0.5} value={graph3dNodeSpacing} onChange={(event) => setGraph3dNodeSpacing(updateNumberSetting(event.target.value, graph3dNodeSpacing, 2, 20))} aria-label="Distância entre nós no grafo 3D" />
              </label>
              <label className="graph-settings-row">
                <span>Velocidade de orbitação<small>Multiplicador do giro orbital</small></span>
                <Field type="number" size="xs" min={0.1} max={5} step={0.1} value={graph3dOrbitSpeed} onChange={(event) => setGraph3dOrbitSpeed(updateNumberSetting(event.target.value, graph3dOrbitSpeed, 0.1, 5))} aria-label="Velocidade de orbitação no grafo 3D" />
              </label>
            </section>
            <section className="graph-settings-group" aria-label="Arestas do grafo">
              <p className="graph-settings-group-title"><Link2 size={12} strokeWidth={1.75} aria-hidden="true" /> Arestas</p>
              <label className="graph-settings-row">
                <span>Aresta máxima<small>Limite superior das conexões</small></span>
                <Field type="number" size="xs" min={4} max={40} step={1} value={graph3dMaxEdgeLength} onChange={(event) => setGraph3dMaxEdgeLength(updateNumberSetting(event.target.value, graph3dMaxEdgeLength, 4, 40))} aria-label="Tamanho máximo das arestas no grafo 3D" />
              </label>
              <label className="graph-settings-row">
                <span>Aresta mínima<small>Distância mínima entre conectados</small></span>
                <Field type="number" size="xs" min={0} max={30} step={0.5} value={graph3dMinEdgeLength} onChange={(event) => setGraph3dMinEdgeLength(updateNumberSetting(event.target.value, graph3dMinEdgeLength, 0, 30))} aria-label="Tamanho mínimo das arestas no grafo 3D" />
              </label>
            </section>
          </section>
          ) : null}

          {/* ---------- 2D: aparece so no modo 2D ---------- */}
          {graphMode3d ? null : (
          <section className="graph-settings-mode" aria-labelledby="graph-settings-modo-2d">
            <p className="graph-settings-mode-head" id="graph-settings-modo-2d">
              <span className="graph-settings-mode-name"><Zap size={12} strokeWidth={1.75} aria-hidden="true" /> Grafo 2D</span>
            </p>
            <section className="graph-settings-group" aria-label="Forças do grafo 2D">
              <p className="graph-settings-group-title"><Zap size={12} strokeWidth={1.75} aria-hidden="true" /> Forças</p>
              <label className="graph-settings-row">
                <span>Afastamento<small>O quanto as notas se empurram entre si</small></span>
                <Field type="number" size="xs" step={50} value={graph2dRepulsionStrength} onChange={(event) => setGraph2dRepulsionStrength(updateNumberSetting(event.target.value, graph2dRepulsionStrength, -Infinity, Infinity))} aria-label="Força de repulsão dos nós no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Firmeza das conexões<small>O quanto duas notas ligadas resistem a se afastar</small></span>
                <Field type="number" size="xs" step={0.1} value={graph2dLinkStiffness} onChange={(event) => setGraph2dLinkStiffness(updateNumberSetting(event.target.value, graph2dLinkStiffness, -Infinity, Infinity))} aria-label="Rigidez da mola das arestas no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Freio<small>Quanto o movimento perde força a cada passo (0 a 0,95); maior, para antes</small></span>
                <Field type="number" size="xs" min={0} max={0.95} step={0.05} value={graph2dVelocityDecay} onChange={(event) => setGraph2dVelocityDecay(updateNumberSetting(event.target.value, graph2dVelocityDecay, 0, 0.95))} aria-label="Amortecimento da velocidade no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Distância das conexões<small>Onde duas notas ligadas param de se puxar</small></span>
                <Field type="number" size="xs" step={0.5} value={graph2dLinkDistance} onChange={(event) => setGraph2dLinkDistance(updateNumberSetting(event.target.value, graph2dLinkDistance, -Infinity, Infinity))} aria-label="Distância do link no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Força para o centro<small>O quanto as notas são puxadas para o meio</small></span>
                <Field type="number" size="xs" step={5} value={graph2dCenterForce} onChange={(event) => setGraph2dCenterForce(updateNumberSetting(event.target.value, graph2dCenterForce, -Infinity, Infinity))} aria-label="Força central do grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Aresta mínima<small>Distância mínima entre duas notas ligadas (0 = sem limite)</small></span>
                <Field type="number" size="xs" min={0} step={1} value={graph2dMinEdgeLength} onChange={(event) => setGraph2dMinEdgeLength(updateNumberSetting(event.target.value, graph2dMinEdgeLength, 0, Infinity))} aria-label="Aresta mínima no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Aresta máxima<small>Distância máxima entre duas notas ligadas (0 = sem limite)</small></span>
                <Field type="number" size="xs" min={0} step={1} value={graph2dMaxEdgeLength} onChange={(event) => setGraph2dMaxEdgeLength(updateNumberSetting(event.target.value, graph2dMaxEdgeLength, 0, Infinity))} aria-label="Aresta máxima no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Raio de colisão<small>Distância mínima entre dois nós; maior, mais espalhado</small></span>
                <Field type="number" size="xs" min={0} step={5} value={graph2dCollideRadius} onChange={(event) => setGraph2dCollideRadius(updateNumberSetting(event.target.value, graph2dCollideRadius, 0, Infinity))} aria-label="Raio de colisão no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Força da colisão<small>Quanto os nós se empurram ao se encostar; menor, menos tremor</small></span>
                <Field type="number" size="xs" min={0} max={2} step={0.05} value={graph2dCollideStrength} onChange={(event) => setGraph2dCollideStrength(updateNumberSetting(event.target.value, graph2dCollideStrength, 0, 2))} aria-label="Força da colisão no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Aquecimento ao arrastar<small>Quanto o conjunto se agita enquanto você arrasta; menor, mais firme</small></span>
                <Field type="number" size="xs" min={0} max={1} step={0.05} value={graph2dDragAlpha} onChange={(event) => setGraph2dDragAlpha(updateNumberSetting(event.target.value, graph2dDragAlpha, 0, 1))} aria-label="Aquecimento da simulação ao arrastar no grafo 2D" />
              </label>
              <label className="graph-settings-row">
                <span>Volta ao centro (s)<small>Tempo que o nó solto leva para voltar ao meio dos vizinhos</small></span>
                <Field type="number" size="xs" min={0.2} max={10} step={0.2} value={graph2dRecentroSeconds} onChange={(event) => setGraph2dRecentroSeconds(updateNumberSetting(event.target.value, graph2dRecentroSeconds, 0.2, 10))} aria-label="Tempo de volta ao centro no grafo 2D" />
              </label>
            </section>
            <section className="graph-settings-group" aria-label="Desempenho do grafo 2D">
              <p className="graph-settings-group-title"><Zap size={12} strokeWidth={1.75} aria-hidden="true" /> Desempenho</p>
              <label className="graph-settings-row">
                <span>Limite de notas exibidas<small>Acima disso, o grafo mostra só a tela e o entorno dela</small></span>
                <Field type="number" size="xs" min={50} max={10000} step={50} value={graphRenderLimit} onChange={(event) => setGraphRenderLimit(updateNumberSetting(event.target.value, graphRenderLimit, 50, 10000))} aria-label="Limite de nós renderizados no grafo 2D" />
              </label>
            </section>
          </section>
          )}

          {/* ---------- comum aos dois ---------- */}
          <section className="graph-settings-mode" aria-labelledby="graph-settings-modo-comum">
            <p className="graph-settings-mode-head" id="graph-settings-modo-comum">
              <span className="graph-settings-mode-name"><Eye size={12} strokeWidth={1.75} aria-hidden="true" /> Exibição (2D e 3D)</span>
            </p>
            <section className="graph-settings-group" aria-label="Exibição do grafo">
              <label className="graph-settings-toggle">
                <span>Mostrar notas sem conexão<small>Inclui notas isoladas no grafo</small></span>
                <input type="checkbox" checked={showGraphOrphans} onChange={(event) => setShowGraphOrphans(event.target.checked)} />
                <span className="graph-settings-toggle-track" aria-hidden="true" />
              </label>
              <label className="graph-settings-toggle">
                <span>Somente notas não conectadas<small>Esconde as conectadas</small></span>
                <input type="checkbox" checked={showOnlyGraphOrphans} onChange={(event) => setShowOnlyGraphOrphans(event.target.checked)} />
                <span className="graph-settings-toggle-track" aria-hidden="true" />
              </label>
              <label className="graph-settings-toggle">
                <span>Ocultar nomes<small>O nome aparece ao passar o mouse na nota</small></span>
                <input type="checkbox" checked={graphHideAllNames} onChange={(event) => setGraphHideAllNames(event.target.checked)} />
                <span className="graph-settings-toggle-track" aria-hidden="true" />
              </label>
              <label className="graph-settings-toggle">
                <span>Agrupar por pasta<small>Notas da mesma pasta ficam juntas e com a mesma cor</small></span>
                <input type="checkbox" checked={graphGroupByFolder} onChange={(event) => setGraphGroupByFolder(event.target.checked)} aria-label="Agrupar por pasta" />
                <span className="graph-settings-toggle-track" aria-hidden="true" />
              </label>
              <label className="graph-settings-toggle">
                <span>Agrupar por tag<small>Notas da mesma tag principal ficam juntas e com a mesma cor</small></span>
                <input type="checkbox" checked={graphGroupByTag} onChange={(event) => setGraphGroupByTag(event.target.checked)} aria-label="Agrupar por tag" />
                <span className="graph-settings-toggle-track" aria-hidden="true" />
              </label>
              {graphGroupByTag ? (
                <label className="graph-settings-row">
                  <span>Tag principal<small>Usada para desempatar notas com várias tags</small></span>
                  <Field as="select" size="xs"
                    value={graphPrimaryTag}
                    onChange={(event) => setGraphPrimaryTag(event.target.value)}
                    aria-label="Tag principal do agrupamento por tag"
                  >
                    <option value="">Primeira tag da nota</option>
                    {graphTagIndexRef.current.allTags().map((tag) => (
                      <option key={tag} value={tag}>#{tag}</option>
                    ))}
                  </Field>
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
                          <Button
                            type="button"
                            className="ui-button graph-settings-color-reset"
                            onClick={() => setGraphColorOverrides((current) => {
                              const next = { ...current }
                              delete next[group.key]
                              return next
                            })}
                            aria-label={`Restaurar cor padrao do grupo ${group.label}`}
                          >Restaurar</Button>
                        ) : null}
                      </label>
                    )
                  })}
                  {Object.keys(graphColorOverrides).length > 0 ? (
                    <Button
                      type="button"
                      className="ui-button graph-settings-color-reset-all"
                      onClick={() => setGraphColorOverrides({})}
                    >Restaurar todas as cores</Button>
                  ) : null}
                </section>
              ) : null}
            </section>
          </section>
          <p className="graph-settings-note"><Info size={12} strokeWidth={1.75} aria-hidden="true" /> Sincronizado com a página de Configurações.</p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
