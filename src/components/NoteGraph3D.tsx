import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { MOUSE } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { birthInterpolation, createForceGraph3DLayout } from '../lib/noteGraph3dLayout'
import { accumulateClusterForces, accumulateOrbitForces, CLUSTER_PHYSICS, ORBIT_PHYSICS, type OrbitElectronState } from '../lib/clusterPhysics'

export type NoteGraph3DNode = {
  name: string
  relativePath: string
}

export type NoteGraph3DLink = {
  source: string
  target: string
}

/** Cena projetada da camera atual, pronta para a exportacao SVG/PNG. */
export type Graph3DExportScene = {
  width: number
  height: number
  nodes: Array<{
    path: string
    x: number
    y: number
    radius: number
    color: string
    label: string
  }>
  links: Array<{
    x1: number
    y1: number
    x2: number
    y2: number
    color: string
  }>
}

export type Graph3DExportRequest = {
  /** Identificador unico do pedido (incrementado a cada clique). */
  id: number
  format: 'svg' | 'png'
  /** Multiplicador de pixels da rasterizacao PNG. */
  scale: number
}

type Props = {
  nodes: NoteGraph3DNode[]
  links: NoteGraph3DLink[]
  degreeByPath: Record<string, number>
  focusedPath: string | null
  currentPath: string | null
  /** Chave de grupo de cada nota (pasta ou tag, agrupamento ativo). */
  groupByPath?: Record<string, string>
  /** Cor de cada grupo (hex). */
  groupColorByPath?: Record<string, string>
  /** Liga o agrupamento visual (layout + cores por pasta ou tag). */
  groupingEnabled?: boolean
  /** Pedido de exportacao: ao mudar, o componente projeta a cena e responde. */
  exportRequest?: Graph3DExportRequest | null
  /** Resposta da exportacao (null quando a cena nao esta pronta). */
  onGraphExport?: (requestId: number, scene: Graph3DExportScene | null) => void
  /** Incrementado pelo botao "Reorganizar" para recalcular o layout 3D. */
  layoutVersion: number
  /** Oculta o nome de todas as notas; o nome aparece apenas no hover do no. */
  hideAllLabels: boolean
  /** Raio base dos orbes 3D (tamanho dos nos). */
  nodeSize: number
  /** Distancia orbital entre o nucleo e os eletrons. */
  nodeSpacing: number
  /** Fator da velocidade de orbitacao. */
  orbitSpeed: number
  /** Comprimento maximo de aresta. */
  maxEdgeLength: number
  /** Comprimento minimo de aresta (nos conectados nao colapsam). */
  minEdgeLength: number
  /** Crescimento do raio por conexao (grau). */
  degreeGrowth: number
  onFocus: (path: string | null) => void
  onOpenNote: (path: string) => void
}

/** Fator de ampliacao da hitbox invisivel de selecao/arrasto. */
const HITBOX_FACTOR = 2.4
/** Escala do halo aditivo em relacao ao raio do orbe (aura de luz). */
const ORB_HALO_SCALE = 3.4
/** Opacidade base do halo aditivo dos orbes. */
const ORB_HALO_OPACITY = 0.5
/** Fisica da mola dos vizinhos puxados (arrasto fluido). */
const PULSE_POOL_SIZE = 14
const PULSE_SPEED = 0.9
const GLOW_DECAY = 1.15
const DRAG_PULL_HOPS = 3
const DRAG_PULL_FACTOR = 0.6
/** Animacao de entrada "Big Bang": todos os nos comecam juntos no centro e se
 * espalham ate o layout final com easing de explosao (repulsao, sem efeitos). */
const BIRTH_DURATION = 1.7

/** WebGL disponivel? Em jsdom (testes) retorna false e o componente renderiza
 * um fallback em vez de quebrar. */
function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Textura radial suave usada no halo dos pulsos (glow de luz aditiva). */
function makeGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.35, 'rgba(190,235,255,0.55)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  }
  return new THREE.CanvasTexture(canvas)
}

type Pulse = {
  mesh: THREE.Mesh
  halo: THREE.Sprite
  trail: THREE.Line
  trailGeometry: THREE.BufferGeometry
  from: THREE.Vector3
  to: THREE.Vector3
  toPath: string
  progress: number
  speed: number
  chains: number
  active: boolean
}

/** Fisica de um cluster de nos ao redor de um ancora fixo: o ancora fica
 * parado (cursor durante o arrasto) e os demais respondem a mola da aresta
 * (descanso = distancia original), a repulsao do ancora, a repulsao par-a-par,
 * as molas das arestas internas e ao comprimento maximo de aresta. */
type ClusterPhysics = {
  /** No ancora: nao se move. */
  anchor: string
  /** Nos que se movem (exclui o ancora). */
  paths: string[]
  /** Fator de decaimento por salto (BFS): 1o salto puxa mais que o 2o/3o. */
  factors: Map<string, number>
  /** Descanso da mola da aresta de cada no para o ancora (distancia original). */
  restDistances: Map<string, number>
  /** Velocidade de cada no (mola com inercia). */
  velocities: Map<string, THREE.Vector3>
  /** Arestas internas do cluster (entre nos movidos). */
  internalEdges: [string, string][]
  /** Arestas com pelo menos um extremo no cluster (comprimento maximo). */
  maxEdgePairs: [string, string][]
}

type DragState = ClusterPhysics & {
  grabOffset: THREE.Vector3
  plane: THREE.Plane
  /** Unico ponto fixo durante o arrasto: o no arrastado segue o cursor. */
  draggedTarget: THREE.Vector3
  startX: number
  startY: number
  startTime: number
  moved: boolean
}

/** Orbita pos-arrasto: os nos com menos conexoes orbitam o elemento com mais
 * conexoes (nucleo) em orbitas esfericas (planos inclinados que precessam), a
 * organizacao de um atomo. Continua ativa ate o proximo arrasto. */
type OrbitState = {
  /** O elemento: no com mais conexoes do cluster (fixo no centro). */
  nucleus: string
  electrons: OrbitElectronState[]
  /** Arestas do cluster (comprimento maximo de aresta). */
  edges: [string, string][]
}

/** Animacao de entrada "Big Bang": todos os nos comecam juntos no centro e se
 * espalham ate o layout final como uma explosao de repulsao (sem efeitos). */
type BirthState = {
  /** Momento de inicio (performance.now()). */
  start: number
  /** Duracao em segundos. */
  duration: number
  /** Centro da explosao (media das posicoes-alvo). */
  center: THREE.Vector3
  /** Maior distancia de um no ao centro (normaliza a velocidade por no). */
  maxRadius: number
  /** Posicoes-alvo (layout final) por caminho. */
  targets: Map<string, THREE.Vector3>
}


type Engine = {
  renderer: THREE.WebGLRenderer
  cssRenderer: CSS2DRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  raycaster: THREE.Raycaster
  nodesMesh: THREE.InstancedMesh | null
  hitMesh: THREE.InstancedMesh | null
  edgesLine: THREE.LineSegments | null
  hoverPath: string | null
  /** Ultimo nivel de detalhe dos rotulos aplicado (zoom out esconde nomes). */
  lastLod: number
  /** Ultimo no em hover (para atualizar o rotulo unico no modo ocultar nomes). */
  lastHoverPath: string | null
  /** Ultimo estado da opcao "ocultar nomes" (atualiza os rotulos ao alternar). */
  lastHideAll: boolean
  labels: Map<string, CSS2DObject>
  /** Halos aditivos dos orbes (aura de luz de cada no). */
  halos: Map<string, THREE.Sprite>
  positions: Map<string, THREE.Vector3>
  instancePaths: string[]
  pathToInstance: Map<string, number>
  linkEndpointsByPath: Map<string, number[]>
  outgoingByPath: Map<string, string[]>
  glows: Map<string, number>
  pulses: Pulse[]
  stars: THREE.Points | null
  clock: THREE.Clock
  lastAmbientAt: number
  nextAmbientIn: number
  pointerDown: { x: number; y: number; time: number; button: number } | null
  pendingEmptyClick: boolean
  drag: DragState | null
  orbit: OrbitState | null
  resizeObserver: ResizeObserver
  updateGraph: () => void
  setFocus: () => void
  fitCamera: () => void
  /** Reaplica os estilos de todos os nos (usado quando as configuracoes mudam). */
  refreshStyles: () => void
  /** Projeta a cena atual pela camera e devolve nos/arestas em pixels (para a
   * exportacao SVG/PNG). Null quando a cena ainda nao foi montada. */
  exportSceneData: () => Graph3DExportScene | null
  dispose: () => void
}

/** Grau minimo para mostrar o rotulo conforme a distancia da camera: quanto
 * mais afastado (zoom out), so nos bem conectados mantem o nome visivel. */
function labelLodDegree(distance: number) {
  if (distance > 165) return 3
  if (distance > 115) return 2
  return 0
}

function nodeColor(degree: number, focused: boolean, current: boolean, folderColorHex?: string) {
  // Paleta clara proposital: o fundo e escuro (navy) e os nos usam material
  // nao-iluminado, entao a cor escolhida aqui e exatamente a cor renderizada.
  // Foco e nota atual mantem prioridade; com agrupamento por pasta ou tag, a
  // cor do grupo substitui a paleta por grau (consistencia visual com a legenda).
  if (current) return new THREE.Color(0xffc96b)
  if (focused) return new THREE.Color(0xb5f0ff)
  if (folderColorHex) return new THREE.Color(folderColorHex)
  if (degree === 0) return new THREE.Color(0x93a7c4)
  if (degree <= 2) return new THREE.Color(0x82b7f2)
  return new THREE.Color(0x5fe6b4)
}

/** Cor do grupo de um no (hex) quando o agrupamento esta ativo, senao null. */
function groupColorFor(data: {
  groupingEnabled?: boolean
  groupByPath?: Record<string, string>
  groupColorByPath?: Record<string, string>
}, path: string): string | undefined {
  if (!data.groupingEnabled) return undefined
  const group = data.groupByPath?.[path]
  if (group === undefined) return undefined
  return data.groupColorByPath?.[group]
}

function buildLabel(name: string, focused: boolean, current: boolean) {
  const element = document.createElement('div')
  element.className = `graph3d-label${focused ? ' is-focused' : ''}${current ? ' is-current' : ''}`
  element.textContent = name.replace(/\.md$/i, '')
  return new CSS2DObject(element)
}

export function NoteGraph3D({
  nodes,
  links,
  degreeByPath,
  focusedPath,
  currentPath,
  layoutVersion,
  hideAllLabels,
  onFocus,
  onOpenNote,
  nodeSize,
  nodeSpacing,
  orbitSpeed,
  maxEdgeLength,
  minEdgeLength,
  degreeGrowth,
  groupByPath,
  groupColorByPath,
  groupingEnabled,
  exportRequest,
  onGraphExport,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const [webglAvailable] = useState(supportsWebGL)

  // Ultimos valores de props: as closures do motor three leem sempre daqui.
  const dataRef = useRef({ nodes, links, degreeByPath, focusedPath, currentPath, layoutVersion, hideAllLabels, nodeSize, nodeSpacing, orbitSpeed, maxEdgeLength, minEdgeLength, degreeGrowth, groupByPath, groupColorByPath, groupingEnabled })
  dataRef.current = { nodes, links, degreeByPath, focusedPath, currentPath, layoutVersion, hideAllLabels, nodeSize, nodeSpacing, orbitSpeed, maxEdgeLength, minEdgeLength, degreeGrowth, groupByPath, groupColorByPath, groupingEnabled }
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const onOpenNoteRef = useRef(onOpenNote)
  onOpenNoteRef.current = onOpenNote
  const onGraphExportRef = useRef(onGraphExport)
  onGraphExportRef.current = onGraphExport

  // Reconstroi o grafo quando o conjunto de nos, o layout ou a configuracao
  // de distancia mudam (a "Distancia entre nos" escala o layout inteiro).
  const sceneKey = useMemo(
    () => nodes.map((node) => node.relativePath).join('\u0000') + '#' + layoutVersion + '#' + nodeSpacing + '#' + (groupingEnabled ? 'group' : 'flat'),
    [groupingEnabled, layoutVersion, nodeSpacing, nodes],
  )

  // Montagem unica do motor three.js.
  useEffect(() => {
    if (!webglAvailable || !containerRef.current) return
    const container = containerRef.current

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x0d1117, 150, 340)

    const camera = new THREE.PerspectiveCamera(55, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 2000)
    camera.position.set(0, 46, 96)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    const cssRenderer = new CSS2DRenderer()
    cssRenderer.setSize(container.clientWidth, container.clientHeight)
    cssRenderer.domElement.style.position = 'absolute'
    cssRenderer.domElement.style.top = '0'
    cssRenderer.domElement.style.left = '0'
    cssRenderer.domElement.style.pointerEvents = 'none'
    container.appendChild(cssRenderer.domElement)

    // Interacao: esquerda = selecionar/arrastar nos (gerenciado por nos),
    // meio = pan, direita = girar. O botao esquerdo fica desabilitado no
    // OrbitControls para nao competir com o arrasto de nos.
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 18
    controls.maxDistance = 280
    controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }

    const raycaster = new THREE.Raycaster()
    const labels = new Map<string, CSS2DObject>()
    const halos = new Map<string, THREE.Sprite>()
    const positions = new Map<string, THREE.Vector3>()
    const instancePaths: string[] = []
    const pathToInstance = new Map<string, number>()
    const linkEndpointsByPath = new Map<string, number[]>()
    const outgoingByPath = new Map<string, string[]>()
    const glows = new Map<string, number>()
    const clock = new THREE.Clock()
    // Animacao de entrada "Big Bang" (variavel de closure: o engine ainda nao
    // existe na primeira chamada de updateGraph, que roda antes de engineRef).
    let birth: BirthState | null = null

    // Fundo: campo de "estrelas" distantes para dar profundidade ao espaco.
    const starCount = 420
    const starGeometry = new THREE.BufferGeometry()
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      const radius = 130 + Math.random() * 260
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      starPositions[i * 3 + 2] = radius * Math.cos(phi)
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMaterial = new THREE.PointsMaterial({
      color: 0x9fb4c8,
      size: 0.7,
      transparent: true,
      opacity: 0.5,
      sizeAttenuation: true,
      depthWrite: false,
    })
    const stars = new THREE.Points(starGeometry, starMaterial)
    scene.add(stars)

    const glowTexture = makeGlowTexture()

    const pulses: Pulse[] = Array.from({ length: PULSE_POOL_SIZE }, () => {
      const coreMaterial = new THREE.MeshBasicMaterial({
        color: 0x8fe3ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), coreMaterial)
      mesh.visible = false
      scene.add(mesh)

      const haloMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xaee9ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const halo = new THREE.Sprite(haloMaterial)
      halo.visible = false
      scene.add(halo)

      const trailGeometry = new THREE.BufferGeometry()
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
      const trailMaterial = new THREE.LineBasicMaterial({
        color: 0x7fd8ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const trail = new THREE.Line(trailGeometry, trailMaterial)
      trail.visible = false
      scene.add(trail)

      return {
        mesh,
        halo,
        trail,
        trailGeometry,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        toPath: '',
        progress: 0,
        speed: PULSE_SPEED,
        chains: 0,
        active: false,
      }
    })

    let nodesMesh: THREE.InstancedMesh | null = null
    let hitMesh: THREE.InstancedMesh | null = null
    let edgesLine: THREE.LineSegments | null = null

    function currentData() {
      return dataRef.current
    }

    /** Raio do orbe: base (configuravel nas settings) + crescimento por
     * conexao (grau) + destaque do foco. O hover nao aumenta mais o no. */
    function nodeRadius(degree: number, focused: boolean) {
      const data = currentData()
      return data.nodeSize + Math.min(degree, 6) * data.degreeGrowth + (focused ? 0.32 : 0)
    }

    /** Reaplica estilo (cor/escala) de um no considerando foco, nota atual e
     * brilho de ativacao. Usado por setFocus e pela animacao de glow. */
    function applyNodeStyle(path: string) {
      const data = currentData()
      const index = pathToInstance.get(path)
      if (index === undefined || !nodesMesh) return
      const position = positions.get(path)
      if (!position) return
      const degree = data.degreeByPath[path] ?? 0
      const focused = path === data.focusedPath
      const current = path === data.currentPath
      const glow = glows.get(path) ?? 0
      const hover = engineRef.current?.hoverPath === path
      const color = nodeColor(degree, focused, current, groupColorFor(data, path))
        .lerp(new THREE.Color(0xd9f7ff), Math.min(1, glow * 0.9))
        .lerp(new THREE.Color(0xffffff), hover ? 0.38 : 0)
      // O hover apenas clareia a cor — nao cresce mais o no.
      const radius = nodeRadius(degree, focused) + glow * 0.42
      const dummy = new THREE.Object3D()
      dummy.position.copy(position)
      dummy.scale.setScalar(radius)
      dummy.updateMatrix()
      nodesMesh.setMatrixAt(index, dummy.matrix)
      nodesMesh.setColorAt(index, color)
      nodesMesh.instanceMatrix.needsUpdate = true
      if (nodesMesh.instanceColor) nodesMesh.instanceColor.needsUpdate = true
      // Halo aditivo acompanha cor, escala e brilho do orbe.
      const halo = halos.get(path)
      if (halo) {
        halo.position.copy(position)
        halo.material.color.copy(color)
        halo.scale.setScalar(radius * ORB_HALO_SCALE * (1 + glow * 0.3))
        ;(halo.material as THREE.SpriteMaterial).opacity = ORB_HALO_OPACITY * (1 + glow * 0.6)
      }
    }

    /** Acende um no (soma do neuronio) com intensidade 0..1, decaindo no loop. */
    function exciteNode(path: string, strength = 1) {
      if (!positions.has(path)) return
      glows.set(path, Math.min(1, (glows.get(path) ?? 0) + strength))
      applyNodeStyle(path)
    }

    function firePulse(fromPath: string, toPath: string, chains = 0) {
      const from = positions.get(fromPath)
      const to = positions.get(toPath)
      if (!from || !to) return
      const pulse = pulses.find((candidate) => !candidate.active)
      if (!pulse) return
      pulse.from.copy(from)
      pulse.to.copy(to)
      pulse.toPath = toPath
      pulse.progress = 0
      pulse.speed = PULSE_SPEED * (0.85 + Math.random() * 0.35)
      pulse.chains = chains
      pulse.active = true
      pulse.mesh.visible = true
      pulse.halo.visible = true
      pulse.trail.visible = true
    }

    /** Disparo sincrono de um neuronio: o soma acende e o sinal sai por todas
     * as arestas incidentes ao mesmo tempo (explosao de foco / atividade). */
    function fireBurst(path: string) {
      const incident = new Set<string>()
      for (const link of currentData().links) {
        if (link.source === path) incident.add(link.target)
        if (link.target === path) incident.add(link.source)
      }
      exciteNode(path, 1)
      for (const neighbor of incident) firePulse(path, neighbor)
    }

    function updateLabels() {
      const data = currentData()
      const neighbors = new Set<string>()
      if (data.focusedPath) {
        for (const link of data.links) {
          if (link.source === data.focusedPath) neighbors.add(link.target)
          if (link.target === data.focusedPath) neighbors.add(link.source)
        }
      }
      const lod = labelLodDegree(controls.getDistance())
      const wanted = new Set<string>()
      for (const node of data.nodes) {
        // "Ocultar nomes" ativo: apenas o no em hover mostra o nome. Usa
        // acesso opcional: updateLabels roda tambem no setup, quando o engine
        // ainda nao foi atribuido (hoverPath ainda nao existe).
        if (data.hideAllLabels) {
          if (node.relativePath === (engineRef.current?.hoverPath ?? null)) wanted.add(node.relativePath)
          continue
        }
        const degree = data.degreeByPath[node.relativePath] ?? 0
        // O LOD vale para qualquer tamanho de grafo: ao dar zoom out, nomes de
        // nos pouco conectados somem (foco, nota atual e vizinhos preservam).
        const isImportant = node.relativePath === data.focusedPath || node.relativePath === data.currentPath || neighbors.has(node.relativePath)
        if (isImportant || degree >= lod) {
          wanted.add(node.relativePath)
        }
      }
      for (const [path, label] of labels) {
        if (!wanted.has(path)) {
          scene.remove(label)
          labels.delete(path)
        }
      }
      for (const node of data.nodes) {
        if (!wanted.has(node.relativePath) || labels.has(node.relativePath)) continue
        const position = positions.get(node.relativePath)
        if (!position) continue
        const label = buildLabel(
          node.name,
          node.relativePath === data.focusedPath,
          node.relativePath === data.currentPath,
        )
        label.position.copy(position)
        labels.set(node.relativePath, label)
        scene.add(label)
      }
      for (const [path, label] of labels) {
        label.element.className = `graph3d-label${path === data.focusedPath ? ' is-focused' : ''}${path === data.currentPath ? ' is-current' : ''}`
      }
    }

    function updateGraph() {
      const data = currentData()
      // A configuracao "Distancia entre nos" escala o layout inteiro; com
      // agrupamento por pasta, o layout agrupa os nos pelo centro da pasta.
      const layout = createForceGraph3DLayout(data.nodes, data.links, 200, {
        nodeSpacing: data.nodeSpacing,
        groupOf: data.groupingEnabled && data.groupByPath
          ? (node) => data.groupByPath?.[node.relativePath] ?? ''
          : undefined,
      })

      positions.clear()
      instancePaths.length = 0
      pathToInstance.clear()
      outgoingByPath.clear()
      linkEndpointsByPath.clear()
      glows.clear()
      if (engineRef.current) {
        engineRef.current.drag = null
        engineRef.current.orbit = null
      }
      birth = null
      for (const node of data.nodes) {
        const position = layout.get(node.relativePath)
        if (!position) continue
        positions.set(node.relativePath, new THREE.Vector3(position.x, position.y, position.z))
        pathToInstance.set(node.relativePath, instancePaths.length)
        instancePaths.push(node.relativePath)
      }
      // Animacao de entrada "Big Bang": guarda o layout final como alvo; o
      // loop de render parte do centro e espalha os nos ate aqui (a camera
      // ja e enquadrada para o grafo final, entao a explosao acontece em
      // vista).
      if (positions.size > 0) {
        const center = new THREE.Vector3()
        for (const position of positions.values()) center.add(position)
        center.divideScalar(positions.size)
        let maxRadius = 0
        for (const position of positions.values()) {
          maxRadius = Math.max(maxRadius, position.distanceTo(center))
        }
        const targets = new Map<string, THREE.Vector3>()
        for (const [path, position] of positions) targets.set(path, position.clone())
        birth = { start: performance.now(), duration: BIRTH_DURATION, center, maxRadius, targets }
      }
      for (const link of data.links) {
        const targets = outgoingByPath.get(link.source) ?? []
        targets.push(link.target)
        outgoingByPath.set(link.source, targets)
      }

      // Limpa os halos antigos dos orbes antes de reconstruir.
      for (const halo of halos.values()) {
        scene.remove(halo)
        halo.material.dispose()
      }
      halos.clear()
      if (nodesMesh) {
        scene.remove(nodesMesh)
        nodesMesh.geometry.dispose()
        ;(nodesMesh.material as THREE.Material).dispose()
        nodesMesh = null
      }
      if (hitMesh) {
        scene.remove(hitMesh)
        hitMesh.geometry.dispose()
        ;(hitMesh.material as THREE.Material).dispose()
        hitMesh = null
      }
      if (data.nodes.length > 0) {
        // Material nao-iluminado: sem luzes na cena, o StandardMaterial renderiza
        // os nos quase pretos (da cor do fundo). Com Basic, o nodeColor aparece
        // exatamente como definido, garantindo contraste.
        nodesMesh = new THREE.InstancedMesh(
          new THREE.SphereGeometry(1, 18, 14),
          new THREE.MeshBasicMaterial(),
          data.nodes.length,
        )
        data.nodes.forEach((node, index) => {
          const position = positions.get(node.relativePath)
          const degree = data.degreeByPath[node.relativePath] ?? 0
          const focused = node.relativePath === data.focusedPath
          const current = node.relativePath === data.currentPath
          const radius = nodeRadius(degree, focused)
          const dummy = new THREE.Object3D()
          dummy.position.copy(position ?? new THREE.Vector3())
          dummy.scale.setScalar(radius)
          dummy.updateMatrix()
          nodesMesh!.setMatrixAt(index, dummy.matrix)
          nodesMesh!.setColorAt(index, nodeColor(degree, focused, current, groupColorFor(data, node.relativePath)))
        })
        nodesMesh.instanceMatrix.needsUpdate = true
        if (nodesMesh.instanceColor) nodesMesh.instanceColor.needsUpdate = true
        scene.add(nodesMesh)

        // Halo aditivo de cada no: transforma os nos em orbes 3D de luz
        // (nucleo esferico + aura brilhante, sempre de frente para a camera).
        const haloMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          transparent: true,
          opacity: ORB_HALO_OPACITY,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
        for (const node of data.nodes) {
          const position = positions.get(node.relativePath)
          const degree = data.degreeByPath[node.relativePath] ?? 0
          const focused = node.relativePath === data.focusedPath
          if (!position) continue
          const halo = new THREE.Sprite(haloMaterial.clone())
          halo.position.copy(position)
          halo.scale.setScalar(nodeRadius(degree, focused) * ORB_HALO_SCALE)
          halo.material.color.copy(nodeColor(degree, focused, node.relativePath === data.currentPath, groupColorFor(data, node.relativePath)))
          scene.add(halo)
          halos.set(node.relativePath, halo)
        }

        // Hitbox invisivel: mesma malha com raio ampliado (HITBOX_FACTOR) para
        // facilitar selecao/arrasto — o raycaster nao ignora objetos invisiveis.
        hitMesh = new THREE.InstancedMesh(
          new THREE.SphereGeometry(1, 10, 8),
          new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
          data.nodes.length,
        )
        hitMesh.visible = false
        data.nodes.forEach((node, index) => {
          const position = positions.get(node.relativePath)
          const degree = data.degreeByPath[node.relativePath] ?? 0
          const focused = node.relativePath === data.focusedPath
          const radius = nodeRadius(degree, focused) * HITBOX_FACTOR
          const dummy = new THREE.Object3D()
          dummy.position.copy(position ?? new THREE.Vector3())
          dummy.scale.setScalar(radius)
          dummy.updateMatrix()
          hitMesh!.setMatrixAt(index, dummy.matrix)
        })
        hitMesh.instanceMatrix.needsUpdate = true
        scene.add(hitMesh)
      }

      if (edgesLine) {
        scene.remove(edgesLine)
        edgesLine.geometry.dispose()
        ;(edgesLine.material as THREE.Material).dispose()
        edgesLine = null
      }
      if (data.links.length > 0) {
        const focusedColor = new THREE.Color(0x8fd4f2)
        const baseColor = new THREE.Color(0x50688a)
        const positionsArray = new Float32Array(data.links.length * 2 * 3)
        const colorsArray = new Float32Array(data.links.length * 2 * 3)
        data.links.forEach((link, index) => {
          const source = positions.get(link.source)
          const target = positions.get(link.target)
          if (!source || !target) return
          const color = data.focusedPath === link.source || data.focusedPath === link.target ? focusedColor : baseColor
          positionsArray.set([source.x, source.y, source.z, target.x, target.y, target.z], index * 6)
          colorsArray.set([color.r, color.g, color.b, color.r, color.g, color.b], index * 6)
          for (const [path, vertexIndex] of [
            [link.source, index * 2],
            [link.target, index * 2 + 1],
          ] as const) {
            const endpoints = linkEndpointsByPath.get(path) ?? []
            endpoints.push(vertexIndex)
            linkEndpointsByPath.set(path, endpoints)
          }
        })
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positionsArray, 3))
        geometry.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3))
        const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 })
        edgesLine = new THREE.LineSegments(geometry, material)
        scene.add(edgesLine)
      }

      for (const pulse of pulses) {
        pulse.active = false
        pulse.mesh.visible = false
        pulse.halo.visible = false
        pulse.trail.visible = false
      }
      updateLabels()
    }

    /** Move um no (ou um vizinho puxado) e atualiza malha, arestas e rotulo. */
    function updateNodePosition(path: string, position: THREE.Vector3) {
      positions.set(path, position)
      applyNodeStyle(path)
      const label = labels.get(path)
      if (label) label.position.copy(position)
      if (edgesLine && linkEndpointsByPath.has(path)) {
        const positionAttribute = edgesLine.geometry.getAttribute('position') as THREE.BufferAttribute
        for (const vertexIndex of linkEndpointsByPath.get(path)!) {
          positionAttribute.setXYZ(vertexIndex, position.x, position.y, position.z)
        }
        positionAttribute.needsUpdate = true
      }
    }

    /** Conjunto de nos puxados junto ao arrastado, com fator de decaimento
     * por distancia (BFS ate DRAG_PULL_HOPS). */
    function buildPullSet(root: string) {
      const adjacency = new Map<string, string[]>()
      for (const link of currentData().links) {
        let sources = adjacency.get(link.source)
        if (!sources) {
          sources = []
          adjacency.set(link.source, sources)
        }
        sources.push(link.target)
        let targets = adjacency.get(link.target)
        if (!targets) {
          targets = []
          adjacency.set(link.target, targets)
        }
        targets.push(link.source)
      }
      const factors = new Map<string, number>()
      factors.set(root, 1)
      const visited = new Set([root])
      let frontier = [root]
      let hop = 0
      while (frontier.length > 0 && hop < DRAG_PULL_HOPS) {
        const next: string[] = []
        for (const node of frontier) {
          for (const neighbor of adjacency.get(node) ?? []) {
            if (visited.has(neighbor)) continue
            visited.add(neighbor)
            factors.set(neighbor, Math.pow(DRAG_PULL_FACTOR, hop + 1))
            next.push(neighbor)
          }
        }
        frontier = next
        hop += 1
      }
      return factors
    }

    /** Um passo de forcas do cluster durante o arrasto: as forcas (mola da
     * aresta, repulsao do ancora, repulsao par-a-par, molas das arestas
     * internas e comprimento maximo de aresta) sao acumuladas pela funcao
     * pura accumulateClusterForces; aqui aplicamos amortecimento, integramos
     * a velocidade e movemos os nos. O ancora permanece parado. */
    function stepClusterPhysics(physics: ClusterPhysics, delta: number) {
      const anchorPosition = positions.get(physics.anchor)
      if (!anchorPosition) return
      accumulateClusterForces({
        anchor: anchorPosition,
        paths: physics.paths,
        positions,
        velocities: physics.velocities,
        restDistances: physics.restDistances,
        factors: physics.factors,
        internalEdges: physics.internalEdges,
        maxEdgePairs: physics.maxEdgePairs,
        maxEdgeLength: currentData().maxEdgeLength,
        minEdgeLength: currentData().minEdgeLength,
        delta,
      })
      for (const path of physics.paths) {
        const current = positions.get(path)
        const velocity = physics.velocities.get(path)
        if (!current || !velocity) continue
        velocity.multiplyScalar(Math.max(0, 1 - CLUSTER_PHYSICS.damping * delta))
        current.addScaledVector(velocity, delta)
        updateNodePosition(path, current)
      }
    }

    /** Monta o estado orbital apos o arrasto: nucleo = no com mais conexoes do
     * cluster (o "elemento"); eletrons = demais, cada um com orbita propria —
     * raio por camada eletronica e plano com inclinacao distribuida pela
     * esfera (Fibonacci), que precessa lentamente para varrer 3D. */
    function buildOrbitState(drag: DragState): OrbitState | null {
      const data = currentData()
      const cluster = [drag.anchor, ...drag.paths]
      const nucleus = cluster.reduce((best, path) => {
        const degree = data.degreeByPath[path] ?? 0
        return degree > (data.degreeByPath[best] ?? 0) ? path : best
      }, drag.anchor)
      const nucleusPosition = positions.get(nucleus)
      if (!nucleusPosition) return null
      const electrons: OrbitElectronState[] = []
      const electronCount = Math.max(cluster.length - 1, 1)
      let electronIndex = 0
      for (const path of cluster) {
        if (path === nucleus) continue
        const position = positions.get(path)
        if (!position) continue
        // Orbitas em camadas (como camadas eletronicas): 3 aneis de raios
        // 1x/1.35x/1.7x da "Distancia entre nos", intercalados pelo indice
        // para distribuir os eletrons sem aglomerar todos num anel unico.
        const shell = electronIndex % 3
        const radius = data.nodeSpacing * (1 + shell * 0.35) * (0.95 + Math.random() * 0.1)
        // Inclinacao do plano orbital distribuida pela esfera (Fibonacci):
        // cada eletron orbita num plano com orientacao diferente em 3D —
        // equatorial, vertical, inclinado — cobrindo a casca como um atomo.
        const y = 1 - (2 * (electronIndex + 0.5)) / electronCount
        const inclination = Math.acos(Math.max(-1, Math.min(1, y)))
        const angularSpeed = (ORBIT_PHYSICS.baseSpeed * data.orbitSpeed) / (1 + radius * 0.06)
        electrons.push({
          path,
          radius,
          angle: Math.random() * Math.PI * 2,
          angularSpeed,
          inclination,
          azimuth: Math.random() * Math.PI * 2,
          // Precessao: o plano gira devagar ao redor do eixo vertical, entao
          // cada eletron varre uma faixa da esfera (nao um circulo fixo).
          precessionSpeed: angularSpeed * ORBIT_PHYSICS.precessionRatio,
          velocity: drag.velocities.get(path) ?? new THREE.Vector3(),
        })
        electronIndex += 1
      }
      if (electrons.length === 0) return null
      // Arestas do cluster (ambos os extremos dentro do cluster) para o limite.
      const clusterSet = new Set(cluster)
      const edges: [string, string][] = []
      for (const link of data.links) {
        if (clusterSet.has(link.source) && clusterSet.has(link.target)) edges.push([link.source, link.target])
      }
      return { nucleus, electrons, edges }
    }

    function ndcFromEvent(event: PointerEvent) {
      const bounds = renderer.domElement.getBoundingClientRect()
      return new THREE.Vector2(
        ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
        -((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1,
      )
    }

    function pickNode(event: PointerEvent) {
      if (hitMesh) {
        raycaster.setFromCamera(ndcFromEvent(event), camera)
        const hits = raycaster.intersectObject(hitMesh)
        if (hits.length > 0 && hits[0].instanceId !== undefined) {
          const path = instancePaths[hits[0].instanceId] ?? null
          if (path) return path
        }
      }
      // Fallback: o ponteiro pode estar sobre o rotulo (nome) do no, que e um
      // overlay DOM maior que a esfera — verifica o retangulo real de cada
      // rotulo visivel (de tras para frente, respeitando a ordem de pintura).
      for (const [path, label] of [...labels.entries()].reverse()) {
        const rect = label.element.getBoundingClientRect()
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        ) {
          return path
        }
      }
      return null
    }

    function handlePointerMove(event: PointerEvent) {
      const engine = engineRef.current!
      const drag = engine.drag
      if (drag && (event.buttons & 1)) {
        const hit = new THREE.Vector3()
        raycaster.setFromCamera(ndcFromEvent(event), camera)
        if (raycaster.ray.intersectPlane(drag.plane, hit)) {
          // Unico ponto fixado: o no arrastado acompanha o cursor (hit - grabOffset
          // mantem o no sob o cursor). Os vizinhos nao recebem alvo rigido — as
          // forcas do cluster sao aplicadas no loop de renderizacao.
          drag.draggedTarget.copy(hit).sub(drag.grabOffset)
          exciteNode(drag.anchor, 0.7)
          if (!drag.moved && (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3)) {
            drag.moved = true
          }
        }
        renderer.domElement.style.cursor = 'grabbing'
        return
      }
      const engineRefNow = engineRef.current!
      const path = pickNode(event)
      renderer.domElement.style.cursor = path ? 'grab' : 'default'
      // Hover: realca o no (cor/escala) para indicar que e clicavel/arrastavel.
      // A selecao em si so acontece no clique (pointerup).
      if (path !== engineRefNow.hoverPath) {
        const previous = engineRefNow.hoverPath
        engineRefNow.hoverPath = path
        if (previous) applyNodeStyle(previous)
        if (path) applyNodeStyle(path)
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const engine = engineRef.current!
      engine.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now(), button: event.button }
      if (event.button !== 0) return
      if (engine.drag) return
      const path = pickNode(event)
      if (!path) {
        engine.pendingEmptyClick = true
        return
      }
      // Ao iniciar um arrasto, limpa o realce de hover (o glow do arrasto cobre).
      if (engine.hoverPath) {
        applyNodeStyle(engine.hoverPath)
        engine.hoverPath = null
      }
      const position = positions.get(path)
      if (!position) return
      const plane = new THREE.Plane()
      const normal = new THREE.Vector3()
      camera.getWorldDirection(normal)
      plane.setFromNormalAndCoplanarPoint(normal, position)
      const hit = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const grabOffset = hit.clone().sub(position)
      const factors = buildPullSet(path)
      const paths = [...factors.keys()].filter((pulledPath) => pulledPath !== path)
      const restDistances = new Map<string, number>()
      const velocities = new Map<string, THREE.Vector3>()
      for (const pulledPath of paths) {
        const pulledPosition = positions.get(pulledPath)
        if (pulledPosition) {
          restDistances.set(pulledPath, Math.max(pulledPosition.distanceTo(position), 0.001))
          velocities.set(pulledPath, new THREE.Vector3())
        }
      }
      const pathSet = new Set(paths)
      const clusterSet = new Set([path, ...paths])
      const internalEdges: [string, string][] = []
      const maxEdgePairs: [string, string][] = []
      for (const link of currentData().links) {
        const inside = pathSet.has(link.source) && pathSet.has(link.target)
        if (inside) internalEdges.push([link.source, link.target])
        if (inside || clusterSet.has(link.source) || clusterSet.has(link.target)) maxEdgePairs.push([link.source, link.target])
      }
      // Novo arrasto cancela a orbita anterior e a animacao de entrada
      // ("Big Bang"), assentando os nos no layout final antes de interagir.
      engine.orbit = null
      if (birth) {
        for (const [path, target] of birth.targets) {
          const position = positions.get(path)
          if (position) updateNodePosition(path, position.set(target.x, target.y, target.z))
        }
        birth = null
      }
      engine.drag = {
        anchor: path,
        paths,
        factors,
        restDistances,
        velocities,
        internalEdges,
        maxEdgePairs,
        grabOffset,
        plane,
        draggedTarget: position.clone(),
        startX: event.clientX,
        startY: event.clientY,
        startTime: performance.now(),
        moved: false,
      }
      engine.pendingEmptyClick = false
      exciteNode(path, 0.8)
      renderer.domElement.style.cursor = 'grabbing'
      try {
        renderer.domElement.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture nao esta disponivel em todos os ambientes; sem ela o
        // arrasto apenas para de acompanhar fora da area do canvas.
      }
    }

    function handlePointerUp(event: PointerEvent) {
      const engine = engineRef.current!
      const down = engine.pointerDown
      engine.pointerDown = null
      const drag = engine.drag
      if (drag) {
        renderer.domElement.style.cursor = 'default'
        try {
          if (renderer.domElement.hasPointerCapture?.(event.pointerId)) {
            renderer.domElement.releasePointerCapture(event.pointerId)
          }
        } catch {
          // ignorar
        }
        const moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6
        if (!moved && performance.now() - drag.startTime < 450) {
          // Clique (sem arrasto): seleciona o no; se ja estava selecionado, abre.
          engine.drag = null
          if (drag.anchor === dataRef.current.focusedPath) onOpenNoteRef.current(drag.anchor)
          else onFocusRef.current(drag.anchor)
        } else {
          // Soltou apos arrastar: o cluster se reorganiza como um atomo — os
          // nos com menos conexoes orbitam o elemento com mais conexoes. E a
          // nota e desselecionada.
          engine.drag = null
          engine.orbit = buildOrbitState(drag)
          onFocusRef.current(null)
        }
        return
      }
      if (!down || down.button !== 0) return
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
      const duration = performance.now() - down.time
      if (moved > 6 || duration > 450) return
      const path = pickNode(event)
      if (!path && engine.pendingEmptyClick) {
        engine.pendingEmptyClick = false
        onFocusRef.current(null)
      }
    }

    function handlePointerLeave() {
      const engine = engineRef.current!
      if (engine.hoverPath) {
        applyNodeStyle(engine.hoverPath)
        engine.hoverPath = null
      }
      engine.pendingEmptyClick = false
      renderer.domElement.style.cursor = 'default'
    }

    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)

    function resize() {
      const width = container.clientWidth
      const height = Math.max(container.clientHeight, 1)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      cssRenderer.setSize(width, height)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    updateGraph()

    const render = () => {
      const delta = clock.getDelta()
      const now = performance.now()
      const data = currentData()

      // Animacao de entrada "Big Bang": todos os nos partem juntos do centro
      // e se espalham ate o layout final. Easing exponencial (arranque rapido,
      // assentamento lento) e nos mais distantes saem na frente — a sensacao
      // de uma explosao por repulsao, sem efeitos.
      const activeBirth = birth
      if (activeBirth) {
        const progress = Math.min(1, (now - activeBirth.start) / 1000 / activeBirth.duration)
        for (const [path, target] of activeBirth.targets) {
          const position = positions.get(path)
          if (!position) continue
          const distance = target.distanceTo(activeBirth.center)
          const t = birthInterpolation(progress, distance, activeBirth.maxRadius)
          position.set(
            activeBirth.center.x + (target.x - activeBirth.center.x) * t,
            activeBirth.center.y + (target.y - activeBirth.center.y) * t,
            activeBirth.center.z + (target.z - activeBirth.center.z) * t,
          )
          updateNodePosition(path, position)
        }
        if (progress >= 1) {
          // Assenta no layout exato e encerra a animacao.
          for (const [path, target] of activeBirth.targets) {
            const position = positions.get(path)
            if (position) updateNodePosition(path, position.set(target.x, target.y, target.z))
          }
          birth = null
        }
      }

      // Arrasto fluido: o no segurado acompanha o cursor; os vizinhos do
      // cluster respondem a repulsao par-a-par, as molas das arestas e ao
      // comprimento maximo de aresta e, ao soltar, passam a orbitar o elemento
      // com mais conexoes (organizacao tipo atomo).
      const drag = engineRef.current!.drag
      if (drag) {
        // O no arrastado e o unico ponto fixado: acompanha o cursor.
        updateNodePosition(drag.anchor, drag.draggedTarget)
        // Vizinhos: sem alvo rigido — repulsao par-a-par + mola da aresta +
        // comprimento maximo de aresta.
        stepClusterPhysics(drag, delta)
      } else {
        const orbit = engineRef.current!.orbit
        if (orbit) {
          // Orbita pos-arrasto (organizacao tipo atomo): os eletrons orbitam o
          // nucleo em movimento continuo, repelindo-se entre si e presos pelo
          // comprimento maximo de aresta.
          const nucleusPosition = positions.get(orbit.nucleus)
          if (nucleusPosition) {
            accumulateOrbitForces({
              nucleus: nucleusPosition,
              electrons: orbit.electrons,
              positions,
              edges: orbit.edges,
              maxEdgeLength: currentData().maxEdgeLength,
              minEdgeLength: currentData().minEdgeLength,
              delta,
            })
            for (const electron of orbit.electrons) {
              const current = positions.get(electron.path)
              if (!current) continue
              const damping = Math.max(0, 1 - ORBIT_PHYSICS.damping * delta)
              electron.velocity.x *= damping
              electron.velocity.y *= damping
              electron.velocity.z *= damping
              current.x += electron.velocity.x * delta
              current.y += electron.velocity.y * delta
              current.z += electron.velocity.z * delta
              updateNodePosition(electron.path, current)
            }
          }
        }
      }

      // Decaimento do brilho de ativacao dos nos (soma do neuronio).
      if (glows.size > 0) {
        for (const [path, value] of glows) {
          const next = value - delta * GLOW_DECAY
          if (next <= 0) {
            glows.delete(path)
            applyNodeStyle(path)
          } else {
            glows.set(path, next)
            applyNodeStyle(path)
          }
        }
      }

      // Pulsos: particula com halo de luz e rastro de cometa; ao chegar, o
      // neuronio destino acende (excitacao sinaptica) e pode propagar o sinal.
      for (const pulse of pulses) {
        if (!pulse.active) continue
        pulse.progress += delta * pulse.speed
        if (pulse.progress >= 1) {
          const arrivedPath = pulse.toPath
          pulse.active = false
          pulse.mesh.visible = false
          pulse.halo.visible = false
          pulse.trail.visible = false
          if (arrivedPath) {
            exciteNode(arrivedPath, 0.9)
            if (pulse.chains < 3) {
              const next = outgoingByPath.get(arrivedPath) ?? []
              if (next.length > 0 && Math.random() < 0.65) {
                firePulse(arrivedPath, next[Math.floor(Math.random() * next.length)], pulse.chains + 1)
              }
            }
          }
          continue
        }
        const eased = 1 - Math.pow(1 - pulse.progress, 3)
        pulse.mesh.position.lerpVectors(pulse.from, pulse.to, eased)
        const intensity = Math.sin(pulse.progress * Math.PI)
        ;(pulse.mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + intensity * 0.7
        pulse.mesh.scale.setScalar(0.7 + intensity * 0.9)
        pulse.halo.position.copy(pulse.mesh.position)
        pulse.halo.scale.setScalar((2.4 + intensity * 3.6) * (0.8 + intensity))
        ;(pulse.halo.material as THREE.SpriteMaterial).opacity = 0.12 + intensity * 0.55
        const direction = pulse.to.clone().sub(pulse.from).normalize()
        const tail = pulse.mesh.position.clone().addScaledVector(direction, -(1.1 + intensity * 1.8))
        const trailAttribute = pulse.trailGeometry.getAttribute('position') as THREE.BufferAttribute
        trailAttribute.setXYZ(0, tail.x, tail.y, tail.z)
        trailAttribute.setXYZ(1, pulse.mesh.position.x, pulse.mesh.position.y, pulse.mesh.position.z)
        trailAttribute.needsUpdate = true
        ;(pulse.trail.material as THREE.LineBasicMaterial).opacity = 0.25 + intensity * 0.6
      }

      // Atividade ambiente: um neuronio conectado dispara em sincronia —
      // o soma acende e o sinal sai por todas as arestas de uma vez.
      if (now - engineRef.current!.lastAmbientAt > engineRef.current!.nextAmbientIn) {
        engineRef.current!.lastAmbientAt = now
        engineRef.current!.nextAmbientIn = 2100 + Math.random() * 1900
        const candidates = data.nodes.filter((node) => (data.degreeByPath[node.relativePath] ?? 0) > 0)
        if (candidates.length > 0) {
          fireBurst(candidates[Math.floor(Math.random() * candidates.length)].relativePath)
        }
      }

      if (stars) stars.rotation.y += delta * 0.004

      // Nivel de detalhe dos rotulos: ao dar zoom out, nomes de nos com poucas
      // conexoes somem (e reaparecem ao aproximar). No modo "ocultar nomes",
      // o rotulo do no em hover precisa acompanhar o movimento do mouse.
      const engineNow = engineRef.current!
      const lod = labelLodDegree(controls.getDistance())
      const hideAll = currentData().hideAllLabels
      if (lod !== engineNow.lastLod || engineNow.hoverPath !== engineNow.lastHoverPath || hideAll !== engineNow.lastHideAll) {
        engineNow.lastLod = lod
        engineNow.lastHoverPath = engineNow.hoverPath
        engineNow.lastHideAll = hideAll
        updateLabels()
      }

      controls.update()
      renderer.render(scene, camera)
      cssRenderer.render(scene, camera)
    }
    renderer.setAnimationLoop(render)

    const engine: Engine = {
      renderer,
      cssRenderer,
      scene,
      camera,
      controls,
      raycaster,
      nodesMesh,
      hitMesh,
      edgesLine,
      hoverPath: null,
      lastLod: 0,
      lastHoverPath: null,
      lastHideAll: false,
      labels,
      halos,
      positions,
      instancePaths,
      pathToInstance,
      linkEndpointsByPath,
      outgoingByPath,
      glows,
      pulses,
      stars,
      clock,
      lastAmbientAt: 0,
      nextAmbientIn: 2600,
      pointerDown: null,
      pendingEmptyClick: false,
      drag: null,
      orbit: null,
      resizeObserver,
      updateGraph,
      refreshStyles() {
        for (const path of instancePaths) applyNodeStyle(path)
      },
      exportSceneData() {
        const data = currentData()
        if (positions.size === 0 || !nodesMesh) return null
        const width = container.clientWidth
        const height = Math.max(container.clientHeight, 1)
        const halfHeight = height / 2
        const fovTangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        const projected = new THREE.Vector3()
        const color = new THREE.Color()
        const nameByPath = new Map(data.nodes.map((node) => [node.relativePath, node.name]))

        const projectWorld = (world: THREE.Vector3): { x: number; y: number; z: number } | null => {
          projected.copy(world).project(camera)
          // Apenas nos/arestas na frente da camera (fora do plano traseiro).
          if (projected.z > 1) return null
          return {
            x: ((projected.x + 1) / 2) * width,
            y: ((1 - projected.y) / 2) * height,
            z: projected.z,
          }
        }

        const sceneNodes: Graph3DExportScene['nodes'] = []
        for (const [path, position] of positions) {
          const screen = projectWorld(position)
          const instanceIndex = pathToInstance.get(path)
          if (!screen || instanceIndex === undefined) continue
          const degree = data.degreeByPath[path] ?? 0
          const worldRadius = nodeRadius(degree, path === data.focusedPath)
          const distance = camera.position.distanceTo(position)
          const radiusPx = Math.max(2, (worldRadius * halfHeight) / (Math.max(distance, 0.001) * fovTangent))
          nodesMesh.getColorAt(instanceIndex, color)
          sceneNodes.push({
            path,
            x: screen.x,
            y: screen.y,
            radius: radiusPx,
            color: `#${color.getHexString()}`,
            label: (nameByPath.get(path) ?? path).replace(/\.md$/i, ''),
          })
        }

        const focusedEdgeColor = '#8fd4f2'
        const baseEdgeColor = '#50688a'
        const sceneLinks: Graph3DExportScene['links'] = []
        for (const link of data.links) {
          const source = positions.get(link.source)
          const target = positions.get(link.target)
          if (!source || !target) continue
          const start = projectWorld(source)
          const end = projectWorld(target)
          if (!start || !end) continue
          const focused = data.focusedPath === link.source || data.focusedPath === link.target
          sceneLinks.push({
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            color: focused ? focusedEdgeColor : baseEdgeColor,
          })
        }

        return { width, height, nodes: sceneNodes, links: sceneLinks }
      },
      fitCamera() {
        if (positions.size === 0) return
        let minX = Infinity
        let minY = Infinity
        let minZ = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        let maxZ = -Infinity
        for (const position of positions.values()) {
          minX = Math.min(minX, position.x)
          minY = Math.min(minY, position.y)
          minZ = Math.min(minZ, position.z)
          maxX = Math.max(maxX, position.x)
          maxY = Math.max(maxY, position.y)
          maxZ = Math.max(maxZ, position.z)
        }
        const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2)
        const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2
        const distance = Math.max(
          (radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.55,
          controls.minDistance + 4,
        )
        controls.target.copy(center)
        camera.position.copy(center).add(new THREE.Vector3(0, distance * 0.5, distance))
        controls.update()
      },
      setFocus() {
        const data = currentData()
        const focusedColor = new THREE.Color(0x8fd4f2)
        const baseColor = new THREE.Color(0x50688a)
        for (const node of data.nodes) {
          applyNodeStyle(node.relativePath)
        }
        if (edgesLine) {
          const colors = edgesLine.geometry.getAttribute('color') as THREE.BufferAttribute
          const color = new THREE.Color()
          data.links.forEach((link, index) => {
            const focused = data.focusedPath === link.source || data.focusedPath === link.target
            color.copy(focused ? focusedColor : baseColor)
            colors.setXYZ(index * 2, color.r, color.g, color.b)
            colors.setXYZ(index * 2 + 1, color.r, color.g, color.b)
          })
          colors.needsUpdate = true
        }
        updateLabels()
        if (data.focusedPath) fireBurst(data.focusedPath)
      },
      dispose() {
        renderer.setAnimationLoop(null)
        resizeObserver.disconnect()
        renderer.domElement.removeEventListener('pointermove', handlePointerMove)
        renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
        renderer.domElement.removeEventListener('pointerup', handlePointerUp)
        renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
        controls.dispose()
        if (hitMesh) {
          hitMesh.geometry.dispose()
          ;(hitMesh.material as THREE.Material).dispose()
        }
        for (const pulse of pulses) {
          pulse.mesh.geometry.dispose()
          ;(pulse.mesh.material as THREE.Material).dispose()
          ;(pulse.halo.material as THREE.Material).dispose()
          pulse.trail.geometry.dispose()
          ;(pulse.trail.material as THREE.Material).dispose()
        }
        glowTexture.dispose()
        starGeometry.dispose()
        starMaterial.dispose()
        if (nodesMesh) nodesMesh.geometry.dispose()
        if (edgesLine) edgesLine.geometry.dispose()
        for (const halo of halos.values()) {
          scene.remove(halo)
          halo.material.dispose()
        }
        for (const label of labels.values()) {
          scene.remove(label)
        }
        renderer.dispose()
        if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement)
        if (cssRenderer.domElement.parentElement === container) container.removeChild(cssRenderer.domElement)
      },
    }
    engineRef.current = engine

    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webglAvailable])

  // Reconstroi quando o conjunto de nos/arestas ou o layout muda.
  useEffect(() => {
    engineRef.current?.updateGraph()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey])

  // Foco/nota atual: destaca, atualiza rotulos dos vizinhos e dispara pulsos.
  useEffect(() => {
    engineRef.current?.setFocus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPath, currentPath, sceneKey])

  // Encaixa a camera para enxergar todos os nos ao montar/reorganizar o grafo.
  useEffect(() => {
    engineRef.current?.fitCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey])

  // Configuracoes de tamanho: reaplica os estilos dos orbes em tempo real.
  useEffect(() => {
    engineRef.current?.refreshStyles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeSize, degreeGrowth])

  // Exportacao: ao receber um pedido novo, projeta a cena atual pela camera e
  // devolve os dados para o App montar o SVG/PNG (a rasterizacao fica no App).
  useEffect(() => {
    if (!exportRequest) return
    const scene = engineRef.current?.exportSceneData() ?? null
    onGraphExportRef.current?.(exportRequest.id, scene)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportRequest])

  if (!webglAvailable) {
    return (
      <div className="note-graph-3d note-graph-3d-fallback" role="status">
        Modo 3D indisponivel: o WebGL nao esta habilitado neste dispositivo.
      </div>
    )
  }

  return <div ref={containerRef} className="note-graph-3d" role="region" aria-label="Grafo 3D das notas" />
}
