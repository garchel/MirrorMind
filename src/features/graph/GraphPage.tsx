import { Suspense, lazy, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from 'react'
import { Button } from '../../components/ui/Button'
import { ExternalLink, Link2, Network, PanelLeft, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '../../components/ui/drawer'
import { GraphSkeleton } from '../../components/PageSkeleton'
import { Graph3DLoader } from '../../components/Graph3DLoader'
import { GraphToolbar, type GraphMode } from '../../components/GraphToolbar'
import { Graph2dCanvas } from './Graph2dCanvas'
import { getMarkdownPreviewText } from '../../lib/markdown'
import { buildGroupMaps } from '../../lib/graphGrouping'
import type { TagIndex } from '../../lib/tagIndex'
import type {
  Graph2DPhysics,
  GraphDocument,
  GraphPosition,
  GraphViewport,
  NoteGraphLink,
} from '../../lib/graphTypes'
import type { useGraphSettings } from '../../lib/useGraphSettings'
import type { Graph3DExportRequest, Graph3DExportScene } from '../../components/NoteGraph3D'

// three.js e pesado (~600 KB): carregado sob demanda, apenas quando o usuario
// abre o modo 3D do grafo pela primeira vez.
const NoteGraph3D = lazy(() => import('../../components/NoteGraph3D').then((module) => ({ default: module.NoteGraph3D })))

/** Página do Grafo extraída do `App.tsx`: mesmos nomes de estado, mesmos
 * textos, mesmos comportamentos. O App continua dono dos estados, das
 * simulações (2D/3D), dos memos derivados e das ações de vault; aqui entra
 * só o render. Valores numéricos do grafo vêm do `graph` (useGraphSettings),
 * como na página de Configurações. */
/** Documentos do grafo (listas + contagem para o progresso). */
export type GraphDocuments = {
  /** `notes.length` (mensagem de progresso da leitura dos links). */
  totalNoteCount: number
  all: GraphDocument[]
  visible: GraphDocument[]
  rendered: GraphDocument[]
  orphans: GraphDocument[]
}

/** Topologia derivada (links, graus, posições e conjuntos de highlight). */
export type GraphTopology = {
  links: NoteGraphLink[]
  degreeByPath: Record<string, number>
  positions: Record<string, GraphPosition>
  renderedPaths: Set<string>
  dimmedPaths: Set<string> | null
  hoverNeighbors: Set<string> | null
}

/** Filtros, agrupamento e órfãs (valores + setters). */
export type GraphFilters = {
  folders: string[]
  tags: string[]
  active: boolean
  matchPaths: Set<string> | null
  groupingKind: 'folder' | 'tag' | null
  groupMaps: ReturnType<typeof buildGroupMaps> | null
  summarized: boolean
  mode: GraphMode
  setMode: Dispatch<SetStateAction<GraphMode>>
  localDepth: number
  setLocalDepth: Dispatch<SetStateAction<number>>
  folder: string
  setFolder: Dispatch<SetStateAction<string>>
  tag: string
  setTag: Dispatch<SetStateAction<string>>
  query: string
  setQuery: Dispatch<SetStateAction<string>>
  hideAllNames: boolean
  setHideAllNames: Dispatch<SetStateAction<boolean>>
  groupByFolder: boolean
  setGroupByFolder: Dispatch<SetStateAction<boolean>>
  groupByTag: boolean
  setGroupByTag: Dispatch<SetStateAction<boolean>>
  primaryTag: string
  setPrimaryTag: Dispatch<SetStateAction<string>>
  colorOverrides: Record<string, string>
  setColorOverrides: Dispatch<SetStateAction<Record<string, string>>>
  showOrphans: boolean
  setShowOrphans: Dispatch<SetStateAction<boolean>>
  showOnlyOrphans: boolean
  setShowOnlyOrphans: Dispatch<SetStateAction<boolean>>
}

/** Estado visual: loading, toolbar, exportação, 3D e viewport. */
export type GraphView = {
  loading: boolean
  loadProgress: number | null
  uiVisible: boolean
  setUiVisible: (visible: boolean) => void
  settingsOpen: boolean
  setSettingsOpenSynced: (open: boolean) => void
  exportOpen: boolean
  setExportOpen: Dispatch<SetStateAction<boolean>>
  exportScale: number
  setExportScale: (scale: number) => void
  exportRequest: Graph3DExportRequest | null
  layoutVersion: number
  mode3d: boolean
  setMode3d: Dispatch<SetStateAction<boolean>>
  viewport: GraphViewport
  setViewport: Dispatch<SetStateAction<GraphViewport>>
}

/** Seleção: foco, hover, drawer e centro local. */
export type GraphSelection = {
  focusedPath: string | null
  setFocusedPath: (path: string | null) => void
  focusedDocument: GraphDocument | null
  incomingLinks: NoteGraphLink[]
  outgoingLinks: NoteGraphLink[]
  incomingNotes: GraphDocument[]
  detailOpen: boolean
  setDetailOpen: (open: boolean) => void
  hoverPath: string | null
  setHoverPath: Dispatch<SetStateAction<string | null>>
  localBeyond: Set<string>
  localCenterPath: string | null
  /** `activeNote?.relativePath` (realce do nó atual). */
  activeNotePath: string | null
}

/** Refs imperativas do loop 2D e da toolbar. */
export type GraphRefs = {
  surfaceRef: RefObject<HTMLDivElement | null>
  panRef: RefObject<{ x: number; y: number; viewport: GraphViewport } | null>
  nodeDragRef: RefObject<string | null>
  skipNodeClickRef: RefObject<boolean>
  physicsRef: RefObject<Graph2DPhysics | null>
  physicsFrameRef: RefObject<number | null>
  nodeElementsRef: RefObject<Map<string, HTMLButtonElement>>
  linkElementsRef: RefObject<Map<string, SVGLineElement>>
  uiHideTimerRef: RefObject<number | null>
  tagIndexRef: RefObject<TagIndex>
}

/** Ações: callbacks do App (sem estado). */
export type GraphActions = {
  updateNumberSetting: (raw: string, current: number, min: number, max: number) => number
  poke: () => void
  resetView: () => void
  openPage: () => void
  reset3d: () => void
  reset2d: () => void
  handleExport: (format: 'svg' | 'png') => void
  handle3dExport: (requestId: number, scene: Graph3DExportScene | null) => void
  startNodeDrag: (relativePath: string, event: PointerEvent<HTMLButtonElement>) => void
  finishNodeDrag: (event: PointerEvent<HTMLButtonElement>) => void
  kickPhysics: () => void
  revealInExplorer: (relativePath: string) => void
  copyWikiLink: (relativePath: string) => void
  /** Vai para `notes` e abre a nota (cobre os 4 fluxos de abertura do grafo). */
  openNote: (relativePath: string) => void
  setConnectQuery: (query: string) => void
  setConnectSource: (document: GraphDocument | null) => void
}

export type GraphPageProps = {
  graph: ReturnType<typeof useGraphSettings>
  documents: GraphDocuments
  topology: GraphTopology
  filters: GraphFilters
  view: GraphView
  selection: GraphSelection
  refs: GraphRefs
  actions: GraphActions
  /** Layout assentado: o App persiste por vault. */
  onGraphLayoutSettled?: (positions: Record<string, { x: number; y: number }>) => void
}

export function GraphPage({
  graph,
  documents,
  topology,
  filters,
  view,
  selection,
  refs,
  actions,
  onGraphLayoutSettled,
}: GraphPageProps) {
  const {
    totalNoteCount,
    all: graphDocuments,
    visible: visibleGraphDocuments,
    rendered: renderedGraphDocuments,
    orphans: orphanGraphDocuments,
  } = documents
  const {
    links: graphLinks,
    degreeByPath: graphDegreeByPath,
    positions: graphNodePositions,
    dimmedPaths: graphDimmedPaths,
    hoverNeighbors: graphHoverNeighbors,
  } = topology
  const {
    folders: graphFolders,
    tags: graphTags,
    active: graphFilterActive,
    matchPaths: graphFilterMatchPaths,
    groupingKind: graphGroupingKind,
    groupMaps: graphGroupMaps,
    summarized: graphIsSummarized,
    mode: graphMode,
    setMode: setGraphMode,
    localDepth: graphLocalDepth,
    setLocalDepth: setGraphLocalDepth,
    folder: graphFolder,
    setFolder: setGraphFolder,
    tag: graphTag,
    setTag: setGraphTag,
    query: graphQuery,
    setQuery: setGraphQuery,
    hideAllNames: graphHideAllNames,
    setHideAllNames: setGraphHideAllNames,
    groupByFolder: graphGroupByFolder,
    setGroupByFolder: setGraphGroupByFolder,
    groupByTag: graphGroupByTag,
    setGroupByTag: setGraphGroupByTag,
    primaryTag: graphPrimaryTag,
    setPrimaryTag: setGraphPrimaryTag,
    colorOverrides: graphColorOverrides,
    setColorOverrides: setGraphColorOverrides,
    showOrphans: showGraphOrphans,
    setShowOrphans: setShowGraphOrphans,
    showOnlyOrphans: showOnlyGraphOrphans,
    setShowOnlyOrphans: setShowOnlyGraphOrphans,
  } = filters
  const {
    loading: isGraphLoading,
    loadProgress: graphLoadProgress,
    uiVisible: graphUiVisible,
    setUiVisible: setGraphUiVisible,
    settingsOpen: graphSettingsOpen,
    setSettingsOpenSynced: setGraphSettingsOpenSynced,
    exportOpen: graphExportOpen,
    setExportOpen: setGraphExportOpen,
    exportScale: graphExportScale,
    setExportScale: setGraphExportScale,
    exportRequest: graphExportRequest,
    layoutVersion: graph3dLayoutVersion,
    mode3d: graphMode3d,
    setMode3d: setGraphMode3d,
    setViewport: setGraphViewport,
  } = view
  const {
    focusedPath: focusedGraphPath,
    setFocusedPath: setFocusedGraphPath,
    focusedDocument: focusedGraphDocument,
    incomingLinks: focusedIncomingLinks,
    outgoingLinks: focusedOutgoingLinks,
    incomingNotes: focusedIncomingNotes,
    detailOpen: graphDetailOpen,
    setDetailOpen: setGraphDetailOpen,
    hoverPath: graphHoverPath,
    setHoverPath: setGraphHoverPath,
    localBeyond: localGraphBeyond,
    localCenterPath: localGraphCenterPath,
    activeNotePath,
  } = selection
  const {
    surfaceRef: graphSurfaceRef,
    uiHideTimerRef: graphUiHideTimerRef,
    tagIndexRef: graphTagIndexRef,
  } = refs
  const {
    updateNumberSetting,
    poke: pokeGraphUi,
    resetView: resetGraphView,
    openPage: openGraphPage,
    reset3d: resetGraph3dSettings,
    reset2d: resetGraph2dSettings,
    handleExport: handleGraphExport,
    handle3dExport: handleGraph3dExport,
    revealInExplorer: revealNoteInExplorer,
    copyWikiLink: copyGraphWikiLink,
    openNote: onOpenNote,
    setConnectQuery: setGraphConnectQuery,
    setConnectSource: setGraphConnectSource,
  } = actions
  const {
    graphRenderLimit,
    setGraphRenderLimit,
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


  // Fisica do Obsidian (constantes lidas do sim.js). Os sliders da toolbar
  // continuam mandando, convertidos para a escala do simulador (link 250,
  // repulsao -30, centro 0.1), que e a escala em que o modelo foi calibrado.
  const graphCanvasSettings = {
    linkDistance: (graph2dLinkDistance / 30) * 250,
    linkStrength: Math.max(0.05, graph2dLinkStiffness / 4),
    // O app.js do Obsidian manda `repelStrength: slider^3` — com o slider em
    // 10 (default) isso e 1000, nao os -30 do fallback do sim.js.
    repelStrength: Math.max(30, (graph2dRepulsionStrength / 2000) * 1000),
    // Piso de 0.1 (o valor do Obsidian): sem ele os nos soltos nao tem nada
    // que os segure e a repulsao os empurra para dezenas de milhares de
    // unidades (medido: extensao 13.9k x 35.5k com o slider em 0).
    centerStrength: Math.max(0.1, (graph2dCenterForce / 100) * 0.1),
    collideRadius: 60,
    collideStrength: 0.5,
    nodeSize: 5,
  }
  const graphCanvasNeighbors = graphHoverNeighbors ?? graphFilterMatchPaths

  return (
    <section
      className="workspace-page graph-page"
      data-builder-name="note-graph-page"
      onPointerMove={pokeGraphUi}
      onPointerDown={pokeGraphUi}
      onWheel={pokeGraphUi}
    >
      {isGraphLoading ? (
        <GraphSkeleton
          message={
            graphLoadProgress !== null && graphLoadProgress > 0
              ? `Lendo os links das notas... (${graphLoadProgress} de ${totalNoteCount} notas)`
              : 'Lendo os links das notas...'
          }
        />
      ) : graphDocuments.length === 0 ? (
        <p className="graph-empty-state graph-empty-state-overlay">Nenhuma nota para mostrar aqui. Crie uma nota ou limpe os filtros para o grafo aparecer.</p>
      ) : (
        <>
          <GraphToolbar
            visible={graphUiVisible}
            onHoverStart={() => { setGraphUiVisible(true); if (graphUiHideTimerRef.current !== null) window.clearTimeout(graphUiHideTimerRef.current) }}
            onHoverEnd={pokeGraphUi}
            graphMode3d={graphMode3d}
            setGraphMode3d={setGraphMode3d}
            graphMode={graphMode}
            setGraphMode={setGraphMode}
            graphLocalDepth={graphLocalDepth}
            setGraphLocalDepth={setGraphLocalDepth}
            graphFolder={graphFolder}
            setGraphFolder={setGraphFolder}
            graphFolders={graphFolders}
            graphTag={graphTag}
            setGraphTag={setGraphTag}
            graphTags={graphTags}
            graphFilterActive={graphFilterActive}
            graphFilterMatchPaths={graphFilterMatchPaths}
            graphQuery={graphQuery}
            setGraphQuery={setGraphQuery}
            setGraphViewport={setGraphViewport}
            resetGraphView={resetGraphView}
            openGraphPage={openGraphPage}
            isGraphLoading={isGraphLoading}
            graphExportOpen={graphExportOpen}
            setGraphExportOpen={setGraphExportOpen}
            graphExportScale={graphExportScale}
            setGraphExportScale={setGraphExportScale}
            handleGraphExport={handleGraphExport}
            graphSettingsOpen={graphSettingsOpen}
            setGraphSettingsOpenSynced={setGraphSettingsOpenSynced}
            resetGraph3dSettings={resetGraph3dSettings}
            resetGraph2dSettings={resetGraph2dSettings}
            graph3dNodeSize={graph3dNodeSize}
            setGraph3dNodeSize={setGraph3dNodeSize}
            graph3dDegreeGrowth={graph3dDegreeGrowth}
            setGraph3dDegreeGrowth={setGraph3dDegreeGrowth}
            graph3dNodeSpacing={graph3dNodeSpacing}
            setGraph3dNodeSpacing={setGraph3dNodeSpacing}
            graph3dOrbitSpeed={graph3dOrbitSpeed}
            setGraph3dOrbitSpeed={setGraph3dOrbitSpeed}
            graph3dMaxEdgeLength={graph3dMaxEdgeLength}
            setGraph3dMaxEdgeLength={setGraph3dMaxEdgeLength}
            graph3dMinEdgeLength={graph3dMinEdgeLength}
            setGraph3dMinEdgeLength={setGraph3dMinEdgeLength}
            graph2dRepulsionStrength={graph2dRepulsionStrength}
            setGraph2dRepulsionStrength={setGraph2dRepulsionStrength}
            graph2dLinkStiffness={graph2dLinkStiffness}
            setGraph2dLinkStiffness={setGraph2dLinkStiffness}
            graph2dVelocityDecay={graph2dVelocityDecay}
            setGraph2dVelocityDecay={setGraph2dVelocityDecay}
            graph2dLinkDistance={graph2dLinkDistance}
            setGraph2dLinkDistance={setGraph2dLinkDistance}
            graph2dCenterForce={graph2dCenterForce}
            setGraph2dCenterForce={setGraph2dCenterForce}
            updateNumberSetting={updateNumberSetting}
            showGraphOrphans={showGraphOrphans}
            setShowGraphOrphans={setShowGraphOrphans}
            showOnlyGraphOrphans={showOnlyGraphOrphans}
            setShowOnlyGraphOrphans={setShowOnlyGraphOrphans}
            graphHideAllNames={graphHideAllNames}
            setGraphHideAllNames={setGraphHideAllNames}
            graphGroupByFolder={graphGroupByFolder}
            setGraphGroupByFolder={setGraphGroupByFolder}
            graphGroupByTag={graphGroupByTag}
            setGraphGroupByTag={setGraphGroupByTag}
            graphPrimaryTag={graphPrimaryTag}
            setGraphPrimaryTag={setGraphPrimaryTag}
            graphTagIndexRef={graphTagIndexRef}
            graphGroupMaps={graphGroupMaps}
            graphColorOverrides={graphColorOverrides}
            setGraphColorOverrides={setGraphColorOverrides}
            graphRenderLimit={graphRenderLimit}
            setGraphRenderLimit={setGraphRenderLimit}
          />
          {graphMode3d ? (
            <Suspense fallback={<Graph3DLoader />}>
              <NoteGraph3D
                nodes={visibleGraphDocuments.map((document) => ({ name: document.name, relativePath: document.relativePath }))}
                links={graphLinks}
                degreeByPath={graphDegreeByPath}
                focusedPath={focusedGraphPath}
                currentPath={activeNotePath}
                dimmedPaths={graphDimmedPaths}
                highlightPaths={graphFilterMatchPaths}
                layoutVersion={graph3dLayoutVersion}
                hideAllLabels={graphHideAllNames}
                nodeSize={graph3dNodeSize}
                nodeSpacing={graph3dNodeSpacing}
                orbitSpeed={graph3dOrbitSpeed}
                maxEdgeLength={graph3dMaxEdgeLength}
                minEdgeLength={graph3dMinEdgeLength}
                degreeGrowth={graph3dDegreeGrowth}
                groupByPath={graphGroupMaps?.groupByPath}
                groupColorByPath={graphGroupMaps?.groupColorByPath}
                groupingEnabled={Boolean(graphGroupingKind)}
                exportRequest={graphExportRequest}
                onGraphExport={handleGraph3dExport}
                onFocus={(path) => { setFocusedGraphPath(path); setGraphDetailOpen(Boolean(path)) }}
                onOpenNote={(relativePath) => onOpenNote(relativePath)}
              />
            </Suspense>
          ) : (
          <div
            ref={graphSurfaceRef}
            className="note-graph note-graph-canvas"
            role="region"
            aria-label="Grafo interativo das notas"
          >
            <Graph2dCanvas
              nodes={renderedGraphDocuments.map((document) => ({
                path: document.relativePath,
                label: document.name.replace(/\.md$/i, ''),
                degree: graphDegreeByPath[document.relativePath] ?? 0,
                color:
                  graphGroupingKind && graphGroupMaps
                    ? (graphGroupMaps.groupColorByPath[graphGroupMaps.groupByPath[document.relativePath] ?? ''] ?? null)
                    : null,
                isCurrent: document.relativePath === activeNotePath,
              }))}
              links={graphLinks}
              settings={graphCanvasSettings}
              hoveredPath={graphHoverPath}
              neighbors={graphCanvasNeighbors}
              reorganizeKey={0}
              initialPositions={graphNodePositions}
              onSettled={onGraphLayoutSettled}
              onHover={setGraphHoverPath}
              onFocus={(path) => {
                setFocusedGraphPath(path)
                setGraphDetailOpen(true)
              }}
              onOpen={onOpenNote}
            />
          </div>
          )}
          {graphGroupingKind && graphGroupMaps && graphGroupMaps.groups.length > 0 ? (
            <aside className="graph-group-legend" aria-label={graphGroupingKind === 'folder' ? 'Legenda das pastas do grafo' : 'Legenda das tags do grafo'}>
              {graphGroupMaps.groups.map((group) => (
                <span key={group.key} className="graph-group-legend-row" title={`${group.label}: ${group.paths.length} ${group.paths.length === 1 ? 'nota' : 'notas'}`}>
                  <span className="graph-group-legend-swatch" style={{ background: group.color }} aria-hidden="true" />
                  <span className="graph-group-legend-name">{group.label}</span>
                  <span className="graph-group-legend-count">{group.paths.length}</span>
                </span>
              ))}
            </aside>
          ) : null}
          <div className="graph-summary-counter" aria-label="Resumo do grafo">
            {graphIsSummarized ? (
              <span>{renderedGraphDocuments.length} de {visibleGraphDocuments.length} notas</span>
            ) : (
              <span>{visibleGraphDocuments.length} {visibleGraphDocuments.length === 1 ? 'nota' : 'notas'}</span>
            )}
            <span>{graphLinks.length} {graphLinks.length === 1 ? 'conexão' : 'conexões'}</span>
          </div>
          {graphIsSummarized ? (
            <p className="graph-culling-note" role="status">Grafo resumido: mostrando {renderedGraphDocuments.length} de {visibleGraphDocuments.length} notas — as que estão na tela e as vizinhas delas. Aproxime para ver as outras ou aumente o limite nas configurações.</p>
          ) : null}
          {graphMode === 'local' && localGraphBeyond.size > 0 ? (
            <p className="graph-local-limit-note">Grafo local limitado: {localGraphBeyond.size} {localGraphBeyond.size === 1 ? 'nota está' : 'notas estão'} além de {graphLocalDepth} {graphLocalDepth === 1 ? 'conexão de distância' : 'conexões de distância'} de {localGraphCenterPath?.split('/').at(-1)?.replace(/\.md$/i, '') ?? 'a nota central'}.</p>
          ) : null}
          <Drawer direction="right" open={graphDetailOpen && Boolean(focusedGraphDocument)} onOpenChange={(open) => { if (!open) { setGraphDetailOpen(false); setFocusedGraphPath(null) } }}>
            <DrawerContent className="graph-note-drawer">
              {focusedGraphDocument ? (
                <>
                  <DrawerHeader className="graph-note-drawer-header">
                    <div className="graph-note-drawer-heading">
                      <p className="graph-note-drawer-eyebrow">Nota no grafo</p>
                      <DrawerTitle>{focusedGraphDocument.name.replace(/\.md$/i, '')}</DrawerTitle>
                      <DrawerDescription>{focusedGraphDocument.relativePath}</DrawerDescription>
                    </div>
                    <Button type="button" className="ui-button graph-note-drawer-close" onClick={() => setGraphDetailOpen(false)} aria-label="Fechar detalhes da nota">
                      <X size={16} strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                  </DrawerHeader>
                  <div className="graph-detail-stats" aria-label="Métricas da nota no grafo">
                    <div className="graph-detail-stat"><strong>{focusedIncomingLinks.length}</strong><span>entradas</span></div>
                    <div className="graph-detail-stat"><strong>{focusedOutgoingLinks.length}</strong><span>saídas</span></div>
                    <div className="graph-detail-stat"><strong>{graphDegreeByPath[focusedGraphDocument.relativePath] ?? 0}</strong><span>conexões</span></div>
                  </div>
                  <div className="graph-note-drawer-section">
                    <p className="graph-note-drawer-section-title">Conteúdo</p>
                    <p className="graph-note-drawer-preview">{getMarkdownPreviewText(focusedGraphDocument.content, 240) || 'Nota vazia.'}</p>
                  </div>
                  {focusedIncomingNotes.length > 0 ? (
                    <div className="graph-note-drawer-section">
                      <p className="graph-note-drawer-section-title">Referenciada por</p>
                      <div className="graph-note-drawer-references">
                        {focusedIncomingNotes.map((note) => (
                          <Button
                            key={note.relativePath}
                            type="button"
                            className="ui-button graph-note-drawer-ref"
                            onClick={() => setFocusedGraphPath(note.relativePath)}
                            title={`Focar ${note.name.replace(/\.md$/i, '')} no grafo`}
                          >
                            {note.name.replace(/\.md$/i, '')}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="graph-note-drawer-actions">
                    <Button type="button" className="ui-button graph-note-drawer-primary" onClick={() => onOpenNote(focusedGraphDocument.relativePath)}>
                      <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" /> Abrir nota
                    </Button>
                    <div className="graph-note-drawer-actions-grid">
                      <Button type="button" variant="secondary" size="md" onClick={() => { setGraphConnectQuery(''); setGraphConnectSource(focusedGraphDocument) }} title={`Criar uma conexao de ${focusedGraphDocument.name.replace(/\.md$/i, '')} para outra nota`}>
                        <Link2 size={14} strokeWidth={1.75} aria-hidden="true" /> Criar conexão
                      </Button>
                      <Button type="button" variant="secondary" size="md" onClick={() => void revealNoteInExplorer(focusedGraphDocument.relativePath)} title="Revelar no explorador de notas">
                        <PanelLeft size={14} strokeWidth={1.75} aria-hidden="true" /> Revelar no explorador
                      </Button>
                      <Button type="button" variant="secondary" size="md" onClick={() => void copyGraphWikiLink(focusedGraphDocument.relativePath)}>
                        <Link2 size={14} strokeWidth={1.75} aria-hidden="true" /> Copiar link da nota
                      </Button>
                      <Button type="button" variant="secondary" size="md" onClick={() => { setGraphDetailOpen(false); setGraphMode('local') }}>
                        <Network size={14} strokeWidth={1.75} aria-hidden="true" /> Grafo local
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
            </DrawerContent>
          </Drawer>
          {showOnlyGraphOrphans ? (
            <section className="graph-orphan-panel" aria-label="Notas não conectadas">
              <div><p className="card-kicker">Limpeza do vault</p><h3>{orphanGraphDocuments.length} notas não conectadas</h3></div>
              {orphanGraphDocuments.length > 0 ? <div className="graph-orphan-list">{orphanGraphDocuments.map((document) => <div key={document.relativePath}><span>{document.name.replace(/\.md$/i, '')}</span><div className="graph-orphan-actions"><Button type="button" variant="secondary" size="md" onClick={() => void revealNoteInExplorer(document.relativePath)} title="Revelar no explorador de notas">Revelar</Button><Button type="button" variant="secondary" size="md" onClick={() => { setGraphConnectQuery(''); setGraphConnectSource(document) }} title={`Criar uma conexão de ${document.name.replace(/\.md$/i, '')} para outra nota`}>Conectar</Button><Button type="button" variant="secondary" size="md" onClick={() => onOpenNote(document.relativePath)}>Abrir</Button></div></div>)}</div> : <p>Nenhuma nota isolada com os filtros atuais.</p>}
            </section>
          ) : null}
          {visibleGraphDocuments.length === 0 ? <p className="graph-empty-state graph-empty-state-overlay">Nenhuma nota corresponde aos filtros atuais.</p> : graphLinks.length === 0 ? <p className="graph-empty-state graph-empty-state-overlay">Ainda não há links internos entre estas notas. Use <code>[[Nome da nota]]</code> para criar conexões.</p> : null}
        </>
      )}
    </section>
  )
}
