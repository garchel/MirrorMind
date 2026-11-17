import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { Eye, Folder, Hash, Info, ListFilter, Palette, Search, Settings, X } from 'lucide-react'
import type { TagIndex } from '../lib/tagIndex'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { GraphFilterSelect } from './GraphFilterSelect'
import './GraphToolbar.css'

/** Barra superior da pagina de grafos. Cuida do que o usuario pode mexer sem
 * risco: dimensao 2D/3D, filtros por pasta/tag, busca, zoom e exibicao. As
 * forcas da simulacao saíram daqui para o controlador de desenvolvimento
 * (`DevControls`) — um numero errado nelas quebra o grafo sem volta obvia. */
export type GraphToolbarProps = {
  visible: boolean
  onHoverStart: () => void
  onHoverEnd: () => void
  graphMode3d: boolean
  setGraphMode3d: Dispatch<SetStateAction<boolean>>
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
  graphSettingsOpen: boolean
  setGraphSettingsOpenSynced: (open: boolean) => void
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
}

export function GraphToolbar(props: GraphToolbarProps) {
  const {
    visible,
    onHoverStart,
    onHoverEnd,
    graphMode3d,
    setGraphMode3d,
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
    graphSettingsOpen,
    setGraphSettingsOpenSynced,
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
      {/* --- grupo 1: o que estou vendo (dimensao + filtro) --- */}
      <h2 className="graph-header-title">Grafo das notas</h2>
      <div className="graph-dimension-toggle" role="radiogroup" aria-label="Dimensao do grafo">
        <Button variant="bare" size="sm" role="radio" aria-checked={!graphMode3d} className={!graphMode3d ? 'is-active' : ''} onClick={() => setGraphMode3d(false)} title="Grafo em 2D">2D</Button>
        <Button variant="bare" size="sm" role="radio" aria-checked={graphMode3d} className={graphMode3d ? 'is-active' : ''} onClick={() => setGraphMode3d(true)} title="Grafo 3D com pulsos eletricos">3D</Button>
      </div>
      <span className="graph-header-sep" aria-hidden="true" />
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
        {graphFilterActive ? (
          <span className="graph-filter-meta" data-active="true">
            <span className="graph-filter-count" role="status">{graphFilterMatchPaths?.size ?? 0} {(graphFilterMatchPaths?.size ?? 0) === 1 ? 'nota' : 'notas'}</span>
            <Button type="button" className="ui-button graph-filter-clear" onClick={() => { setGraphFolder(''); setGraphTag('') }} aria-label="Limpar filtro do grafo" title="Limpar filtro">
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </Button>
          </span>
        ) : null}
      </div>

      {/* --- grupo 2: buscar, camera e menu, colados na direita --- */}
      <div className="graph-header-actions">
        {/* Busca: lupa dentro do campo, largura flexivel e sem borda dura. O
            zoom e o "Centralizar" saíram daqui para o controlador DEV — por isso
            a barra fica identica nos dois modos (2D e 3D). */}
        <span className="graph-search">
          <Search size={13} strokeWidth={2} aria-hidden="true" />
          <Field size="sm" className="graph-search-input" value={graphQuery} onChange={(event) => setGraphQuery(event.target.value)} placeholder="Buscar nota" aria-label="Buscar nota no grafo" />
        </span>
        <Popover open={graphSettingsOpen} onOpenChange={setGraphSettingsOpenSynced}>
          <PopoverTrigger asChild>
            <Button type="button" variant="secondary" size="md" className="graph-icon-button graph-settings-button" aria-label="Configurações do grafo" title="Configurações do grafo">
              <Settings size={15} strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={6} collisionPadding={12} className="graph-settings-popover">
            <header className="graph-settings-header">
              <span className="graph-settings-header-title">
                <Settings size={14} strokeWidth={1.75} aria-hidden="true" />
                <strong>Configurações do grafo</strong>
              </span>
            </header>

            <section className="graph-settings-mode" aria-labelledby="graph-settings-modo-exibicao">
              <p className="graph-settings-mode-head" id="graph-settings-modo-exibicao">
                <span className="graph-settings-mode-name"><Eye size={12} strokeWidth={1.75} aria-hidden="true" /> Exibição</span>
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
            <p className="graph-settings-note"><Info size={12} strokeWidth={1.75} aria-hidden="true" /> Forças e limites ficam no controlador DEV (canto superior).</p>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
