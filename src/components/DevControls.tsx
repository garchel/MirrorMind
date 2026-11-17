import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Bug, RotateCcw, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { BUILDER_FRIENDLY_NAMES } from '../lib/ui-structure'
import './DevControls.css'

/** Forças e limites do grafo 2D. Vivem aqui — e não no menu do usuário —
 * porque um valor errado espalha, colapsa ou derruba o desempenho do grafo,
 * e o usuário comum não tem como desfazer isso sem ajuda. */
export type DevGraph2dSettings = {
  repulsionStrength: number
  setRepulsionStrength: (next: number) => void
  linkStiffness: number
  setLinkStiffness: (next: number) => void
  velocityDecay: number
  setVelocityDecay: (next: number) => void
  linkDistance: number
  setLinkDistance: (next: number) => void
  centerForce: number
  setCenterForce: (next: number) => void
  collideRadius: number
  setCollideRadius: (next: number) => void
  collideStrength: number
  setCollideStrength: (next: number) => void
  dragAlpha: number
  setDragAlpha: (next: number) => void
  recentroSeconds: number
  setRecentroSeconds: (next: number) => void
  minEdgeLength: number
  setMinEdgeLength: (next: number) => void
  maxEdgeLength: number
  setMaxEdgeLength: (next: number) => void
  labelZoom: number
  setLabelZoom: (next: number) => void
  renderLimit: number
  setRenderLimit: (next: number) => void
  reset: () => void
}

/** Visual e orbita do grafo 3D: mesma categoria — numero errado aqui deixa a
 * cena ilegivel ou os nos fora da tela. */
export type DevGraph3dSettings = {
  nodeSize: number
  setNodeSize: (next: number) => void
  degreeGrowth: number
  setDegreeGrowth: (next: number) => void
  nodeSpacing: number
  setNodeSpacing: (next: number) => void
  orbitSpeed: number
  setOrbitSpeed: (next: number) => void
  maxEdgeLength: number
  setMaxEdgeLength: (next: number) => void
  minEdgeLength: number
  setMinEdgeLength: (next: number) => void
  reset: () => void
}

/** Modo do grafo: saiu do menu do usuario (poluia a barra), mas a visao local
 * continua existindo — fica aqui, onde so quem desenvolve troca. */
export type DevGraphMode = {
  mode: 'global' | 'local'
  setMode: (mode: 'global' | 'local') => void
  localDepth: number
  setLocalDepth: (depth: number) => void
}

export type DevExport = {
  scale: number
  setScale: (next: number) => void
  run: (format: 'svg' | 'png') => void
}

export type DevControlsProps = {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  /** Sem isso (ex.: antes de abrir o vault) o painel mostra só os nomes. */
  graph2d?: DevGraph2dSettings
  graph3d?: DevGraph3dSettings
  exportTools?: DevExport
  graphMode?: DevGraphMode
  updateNumberSetting?: (raw: string, current: number, min: number, max: number) => number
}

type TooltipState = { name: string; x: number; y: number }

// A faixa superior da janela (~48px) e a area de arrastar da TitleBar: um
// controle fixo ali recebe o clique da barra, nao o dele. Por isso y comeca
// abaixo dela.
const TOPO_SEGURO = 52

function getInitialPosition() {
  return { x: Math.max(12, window.innerWidth - 300), y: TOPO_SEGURO }
}

/**
 * Controlador do desenvolvedor.
 *
 * Espanou do "Friendly Names": é o mesmo controle flutuante (arrastável), mas
 * ganhou o painel que só quem desenvolve deve abrir — as forças do grafo 2D e
 * o limite de renderização. O que ficou no menu normal do grafo é só o que não
 * quebra nada: exibição, nomes, agrupamento e cores.
 */
export function DevControls({ enabled, onEnabledChange, graph2d, graph3d, exportTools, graphMode, updateNumberSetting }: DevControlsProps) {
  const [position, setPosition] = useState(getInitialPosition)
  const [isDragging, setIsDragging] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)

  // Nomes amigáveis: ao ligar, o ponteiro sobre qualquer área com
  // `data-builder-name` mostra o nome em português em vez do identificador.
  useEffect(() => {
    if (!enabled) {
      setTooltip(null)
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null
      const namedComponent = target?.closest<HTMLElement>('[data-builder-name]')

      if (!namedComponent) {
        setTooltip(null)
        return
      }

      setTooltip({
        name:
          BUILDER_FRIENDLY_NAMES[namedComponent.dataset.builderName ?? ''] ??
          'Area sem nome amigavel',
        x: event.clientX + 14,
        y: event.clientY + 14,
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [enabled])

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragOrigin.current = { x: event.clientX, y: event.clientY }
    setIsDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    if (!dragOrigin.current) return
    const nextX = Math.max(12, Math.min(window.innerWidth - 240, event.clientX - 60))
    const nextY = Math.max(TOPO_SEGURO, Math.min(window.innerHeight - 44, event.clientY - 18))
    setPosition({ x: nextX, y: nextY })
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragOrigin.current = null
    setIsDragging(false)
  }

  const numero = (raw: string, current: number, min: number, max: number) =>
    updateNumberSetting ? updateNumberSetting(raw, current, min, max) : current

  return (
    <>
      <div
        className={`dev-controls${enabled ? ' is-enabled' : ''}${isDragging ? ' is-dragging' : ''}`}
        style={{ left: position.x, top: position.y }}
      >
        <span
          className="dev-controls-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          title="Arraste para mover"
        >
          <Bug size={12} strokeWidth={2} aria-hidden="true" />
          DEV
        </span>

        <label className="dev-controls-switch" title="Friendly names: mostra o nome amigável de cada componente">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
            aria-label={`Friendly Names - ${enabled ? 'ON' : 'OFF'}`}
          />
          <span className="dev-controls-switch-track" aria-hidden="true" />
          <span className="dev-controls-switch-label">Friendly names</span>
        </label>

        {graph2d || graph3d || exportTools || graphMode ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="dev-controls-open"
                aria-label="Controles de desenvolvimento do grafo"
                title="Controles de desenvolvimento — forças do grafo 2D"
              >
                <SlidersHorizontal size={13} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} collisionPadding={12} className="dev-settings-popover">
              <header className="dev-settings-header">
                <span className="dev-settings-title">
                  <Bug size={13} strokeWidth={1.75} aria-hidden="true" />
                  <strong>Controles de desenvolvimento</strong>
                </span>
                <span className="dev-settings-badge">DEV</span>
              </header>

              {graphMode ? (
                <section className="dev-settings-group" aria-label="Modo do grafo">
                  <p className="dev-settings-group-title">Modo do grafo</p>
                  <label className="dev-settings-row">
                    <span>Escopo<small>Global = vault inteiro; local = vizinhança de uma nota</small></span>
                    <Field as="select" size="xs" value={graphMode.mode} onChange={(event) => graphMode.setMode(event.target.value as 'global' | 'local')} aria-label="Modo do grafo">
                      <option value="global">Grafo global</option>
                      <option value="local">Grafo local</option>
                    </Field>
                  </label>
                  {graphMode.mode === 'local' ? (
                    <label className="dev-settings-row">
                      <span>Profundidade<small>Saltos a partir da nota aberta</small></span>
                      <Field as="select" size="xs" value={graphMode.localDepth} onChange={(event) => graphMode.setLocalDepth(Number(event.target.value))} aria-label="Profundidade do grafo local">
                        <option value={1}>1 salto</option>
                        <option value={2}>2 saltos</option>
                        <option value={3}>3 saltos</option>
                      </Field>
                    </label>
                  ) : null}
                </section>
              ) : null}

              {graph2d ? (
              <section className="dev-settings-group" aria-label="Forças do grafo 2D">
                <p className="dev-settings-group-title">Grafo 2D — forças</p>
                <label className="dev-settings-row">
                  <span>Afastamento<small>O quanto as notas se empurram entre si</small></span>
                  <Field type="number" size="xs" step={50} value={graph2d.repulsionStrength} onChange={(event) => graph2d.setRepulsionStrength(numero(event.target.value, graph2d.repulsionStrength, -Infinity, Infinity))} aria-label="Força de repulsão dos nós no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Firmeza das conexões<small>O quanto duas notas ligadas resistem a se afastar</small></span>
                  <Field type="number" size="xs" step={0.1} value={graph2d.linkStiffness} onChange={(event) => graph2d.setLinkStiffness(numero(event.target.value, graph2d.linkStiffness, -Infinity, Infinity))} aria-label="Rigidez da mola das arestas no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Freio<small>Quanto o movimento perde força a cada passo (0 a 0,95)</small></span>
                  <Field type="number" size="xs" min={0} max={0.95} step={0.05} value={graph2d.velocityDecay} onChange={(event) => graph2d.setVelocityDecay(numero(event.target.value, graph2d.velocityDecay, 0, 0.95))} aria-label="Amortecimento da velocidade no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Distância das conexões<small>Onde duas notas ligadas param de se puxar</small></span>
                  <Field type="number" size="xs" step={0.5} value={graph2d.linkDistance} onChange={(event) => graph2d.setLinkDistance(numero(event.target.value, graph2d.linkDistance, -Infinity, Infinity))} aria-label="Distância do link no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Força para o centro<small>O quanto as notas são puxadas para o meio</small></span>
                  <Field type="number" size="xs" step={5} value={graph2d.centerForce} onChange={(event) => graph2d.setCenterForce(numero(event.target.value, graph2d.centerForce, -Infinity, Infinity))} aria-label="Força central do grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Raio de colisão<small>Distância mínima entre dois nós</small></span>
                  <Field type="number" size="xs" min={0} step={5} value={graph2d.collideRadius} onChange={(event) => graph2d.setCollideRadius(numero(event.target.value, graph2d.collideRadius, 0, Infinity))} aria-label="Raio de colisão no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Força da colisão<small>Quanto os nós se empurram ao se encostar</small></span>
                  <Field type="number" size="xs" min={0} max={2} step={0.05} value={graph2d.collideStrength} onChange={(event) => graph2d.setCollideStrength(numero(event.target.value, graph2d.collideStrength, 0, 2))} aria-label="Força da colisão no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Aquecimento ao arrastar<small>Quanto o conjunto se agita enquanto você arrasta</small></span>
                  <Field type="number" size="xs" min={0} max={1} step={0.05} value={graph2d.dragAlpha} onChange={(event) => graph2d.setDragAlpha(numero(event.target.value, graph2d.dragAlpha, 0, 1))} aria-label="Aquecimento da simulação ao arrastar no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Volta ao centro (s)<small>Tempo que o nó solto leva para voltar ao meio dos vizinhos</small></span>
                  <Field type="number" size="xs" min={0.2} max={10} step={0.2} value={graph2d.recentroSeconds} onChange={(event) => graph2d.setRecentroSeconds(numero(event.target.value, graph2d.recentroSeconds, 0.2, 10))} aria-label="Tempo de volta ao centro no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Aresta mínima<small>Distância mínima entre duas notas ligadas (0 = sem limite)</small></span>
                  <Field type="number" size="xs" min={0} step={1} value={graph2d.minEdgeLength} onChange={(event) => graph2d.setMinEdgeLength(numero(event.target.value, graph2d.minEdgeLength, 0, Infinity))} aria-label="Aresta mínima no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Aresta máxima<small>Distância máxima entre duas notas ligadas (0 = sem limite)</small></span>
                  <Field type="number" size="xs" min={0} step={1} value={graph2d.maxEdgeLength} onChange={(event) => graph2d.setMaxEdgeLength(numero(event.target.value, graph2d.maxEdgeLength, 0, Infinity))} aria-label="Aresta máxima no grafo 2D" />
                </label>
                <label className="dev-settings-row">
                  <span>Nomes ao aproximar<small>0 = automático (um passo de zoom acima do enquadramento)</small></span>
                  <Field type="number" size="xs" min={0} max={4} step={0.05} value={graph2d.labelZoom} onChange={(event) => graph2d.setLabelZoom(numero(event.target.value, graph2d.labelZoom, 0, 4))} aria-label="Zoom para mostrar os nomes das notas no grafo 2D" />
                </label>
              </section>

              ) : null}

              {graph3d ? (
                <section className="dev-settings-group" aria-label="Grafo 3D">
                  <p className="dev-settings-group-title">Grafo 3D</p>
                  <label className="dev-settings-row">
                    <span>Tamanho dos nós<small>Raio base dos orbes</small></span>
                    <Field type="number" size="xs" min={0.2} max={3} step={0.05} value={graph3d.nodeSize} onChange={(event) => graph3d.setNodeSize(numero(event.target.value, graph3d.nodeSize, 0.2, 3))} aria-label="Tamanho dos nós no grafo 3D" />
                  </label>
                  <label className="dev-settings-row">
                    <span>Aumento por conexão<small>Crescimento do nó por link</small></span>
                    <Field type="number" size="xs" min={0} max={1} step={0.01} value={graph3d.degreeGrowth} onChange={(event) => graph3d.setDegreeGrowth(numero(event.target.value, graph3d.degreeGrowth, 0, 1))} aria-label="Fator de aumento por conexão no grafo 3D" />
                  </label>
                  <label className="dev-settings-row">
                    <span>Distância entre nós<small>Raio das órbitas ao redor do núcleo</small></span>
                    <Field type="number" size="xs" min={2} max={20} step={0.5} value={graph3d.nodeSpacing} onChange={(event) => graph3d.setNodeSpacing(numero(event.target.value, graph3d.nodeSpacing, 2, 20))} aria-label="Distância entre nós no grafo 3D" />
                  </label>
                  <label className="dev-settings-row">
                    <span>Velocidade de orbitação<small>Multiplicador do giro orbital</small></span>
                    <Field type="number" size="xs" min={0.1} max={5} step={0.1} value={graph3d.orbitSpeed} onChange={(event) => graph3d.setOrbitSpeed(numero(event.target.value, graph3d.orbitSpeed, 0.1, 5))} aria-label="Velocidade de orbitação no grafo 3D" />
                  </label>
                  <label className="dev-settings-row">
                    <span>Aresta máxima<small>Limite superior das conexões</small></span>
                    <Field type="number" size="xs" min={4} max={40} step={1} value={graph3d.maxEdgeLength} onChange={(event) => graph3d.setMaxEdgeLength(numero(event.target.value, graph3d.maxEdgeLength, 4, 40))} aria-label="Tamanho máximo das arestas no grafo 3D" />
                  </label>
                  <label className="dev-settings-row">
                    <span>Aresta mínima<small>Distância mínima entre conectados</small></span>
                    <Field type="number" size="xs" min={0} max={30} step={0.5} value={graph3d.minEdgeLength} onChange={(event) => graph3d.setMinEdgeLength(numero(event.target.value, graph3d.minEdgeLength, 0, 30))} aria-label="Tamanho mínimo das arestas no grafo 3D" />
                  </label>
                  <Button type="button" variant="secondary" size="sm" onClick={graph3d.reset} title="Restaurar os padrões do grafo 3D">
                    <RotateCcw size={12} strokeWidth={1.75} aria-hidden="true" />
                    Padrões do 3D
                  </Button>
                </section>
              ) : null}

              {exportTools ? (
                <section className="dev-settings-group" aria-label="Exportar grafo">
                  <p className="dev-settings-group-title">Exportar</p>
                  <label className="dev-settings-row">
                    <span>Resolução PNG<small>Multiplicador de pixels</small></span>
                    <Field as="select" size="xs" value={exportTools.scale} onChange={(event) => exportTools.setScale(Number(event.target.value))} aria-label="Resolução do PNG exportado">
                      <option value={1}>1x</option>
                      <option value={2}>2x</option>
                      <option value={3}>3x</option>
                    </Field>
                  </label>
                  <span className="dev-settings-row dev-settings-export">
                    <Button type="button" variant="secondary" size="sm" onClick={() => exportTools.run('svg')} aria-label="Exportar grafo como SVG">SVG</Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => exportTools.run('png')} aria-label="Exportar grafo como PNG">PNG</Button>
                  </span>
                </section>
              ) : null}

              {graph2d ? (
                <section className="dev-settings-group" aria-label="Desempenho do grafo 2D">
                  <p className="dev-settings-group-title">Desempenho</p>
                  <label className="dev-settings-row">
                    <span>Limite de notas exibidas<small>Acima disso, o grafo mostra só a tela e o entorno dela</small></span>
                    <Field type="number" size="xs" min={50} max={10000} step={50} value={graph2d.renderLimit} onChange={(event) => graph2d.setRenderLimit(numero(event.target.value, graph2d.renderLimit, 50, 10000))} aria-label="Limite de nós renderizados no grafo 2D" />
                  </label>
                </section>
              ) : null}

              <footer className="dev-settings-footer">
                <p className="dev-settings-note">
                  <TriangleAlert size={12} strokeWidth={1.75} aria-hidden="true" />
                  Valores técnicos. Um número errado aqui espalha, amassa ou trava o grafo.
                </p>
                <Button type="button" variant="secondary" size="sm" onClick={() => graph2d?.reset()} disabled={!graph2d} title="Restaurar os padrões do grafo 2D">
                  <RotateCcw size={12} strokeWidth={1.75} aria-hidden="true" />
                  Padrões do 2D
                </Button>
              </footer>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {tooltip?.name ? (
        <output className="dev-controls-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.name}
        </output>
      ) : null}
    </>
  )
}
