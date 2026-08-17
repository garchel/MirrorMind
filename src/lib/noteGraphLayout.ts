/**
 * Fisica do grafo 2D no modelo do Obsidian (force-directed classico, como o
 * d3-force que o Obsidian usava no graph view):
 *
 * - Mola das arestas (Lei de Hooke): F = (d - linkDistance) * linkStiffness,
 *   com o descanso configuravel ("Link distance" no Obsidian);
 * - Repulsao many-body (Coulomb, inversa ao quadrado): F = -repulsion / d^2,
 *   entre TODOS os pares de nos, com cutoff de distancia (performance) e piso
 *   de distancia para nao explodir em d ~ 0;
 * - Colisao (d3-force collide): pares mais proximos que a soma dos raios se
 *   empurram ao longo da normal — impede sobreposicao e espalha os vizinhos
 *   da nota com mais conexoes uniformemente ao redor dela (o anel do Obsidian);
 * - Center force: puxa para um ANEL ao redor do centro do grafo — nos dentro
 *   do anel ficam soltos (zona morta), fora dele sao puxados de volta:
 *   F = min(d(center, x) - centerRadius, 0) * centerStrength;
 * - Resfriamento alpha (d3-force): todas as forcas escalam por alpha, que
 *   decai por frame ate a simulacao assentar; o arrasto reaquece (alpha = 1);
 * - Decaimento de velocidade (velocity decay) aplicado pelo chamador.
 *
 * O arrasto fixa APENAS o no segurado (pinned); os vizinhos fluem pelas mesmas
 * forcas — sem cluster rigido, como no Obsidian.
 *
 * Posicoes em unidades do mundo 0-GRAPH_2D_WORLD_SIZE (0-200). A funcao de
 * forca e pura: acumula em velocidades (um passo de integracao); o chamador
 * aplica o decaimento e move.
 */
export type NoteGraphPosition = { x: number; y: number }

export type NoteGraphLayoutLink = { source: string; target: string }

/** Transform SVG de uma aresta 2D: a linha base [0,0]-[100,0] e rotacionada e
 * escalada para ligar source -> target em unidades do mundo (0-200). Escrita
 * como UM atributo `transform` por frame (composicao por GPU, sem invalidar o
 * layout do SVG) em vez de 4 atributos de geometria x1/y1/x2/y2 (que forcam
 * re-layout do SVG a cada frame — causa de drop de FPS ao arrastar). */
export function graph2dLineTransform(source: NoteGraphPosition, target: NoteGraphPosition): string {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.hypot(dx, dy)
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI
  const scale = length === 0 ? 0 : length / 100
  return `translate(${source.x} ${source.y}) rotate(${angle}) scale(${scale})`
}

/** Tamanho (em unidades) do espaco de coordenadas do grafo 2D. Dobrado em
 * relacao ao viewBox original 0-100: o espaco em que os nos podem ser
 * arrastados (e o pan/zoom) e o dobro da superficie visivel. */
export const GRAPH_2D_WORLD_SIZE = 200

/** Centro do mundo (o anel da center force e o ponto de fuga do big bang). */
export const GRAPH_2D_WORLD_CENTER = GRAPH_2D_WORLD_SIZE / 2

/** Limites do mundo (%), para os nos nao sairem do espaco de coordenadas. */
export const GRAPH_2D_BOUNDS = { minX: 4, maxX: 196, minY: 5, maxY: 195 }

/** Constantes base do modelo de forcas (unidades do mundo 0-200). */
export const OBSIDIAN_PHYSICS_2D = {
  /** Forca da mola das arestas por unidade alem do descanso (Hooke). Alta o
   * suficiente para os vizinhos seguirem o no arrastado com vivacidade e os
   * comprimentos das arestas convergirem para o descanso (arestas uniformes,
   * como no Obsidian). */
  linkStiffness: 4.0,
  /** Forca da repulsao many-body: forca = repulsionStrength / d^2. Alta para
   * os vizinhos do hub se espacarem em circulo ao redor dele (configuracao
   * de menor repulsao, como no Obsidian). */
  repulsionStrength: 2000,
  /** Pares mais distantes que isso nao se repelem. CURTO de proposito: a
   * repulsao fica LOCAL (espalha os vizinhos do no central em circulo) sem
   * empurrar os nos desgarrados nem grupos distantes — o ajuste que o usuario
   * relatou ("aumentar a repulsao repele demais os outros grupos"). Tambem
   * reduz o custo O(n²) do loop de pares em ~47%. */
  repulsionCutoff: 55,
  /** Piso da distancia ao quadrado para a repulsao nao explodir em d ~ 0. */
  repulsionDistanceMin: 1.5,
  /** Raio do anel da center force ao redor do centro do grafo (100, 100). */
  centerRadius: 60,
  /** Forca da center force por unidade alem do anel. */
  centerStrength: 0.06,
  /** Decaimento da velocidade por segundo (d3 velocityDecay). Igual ao padrao
   * do d3-force (0.4): os nos adquirem momento durante o arrasto, os vizinhos
   * seguem o no segurado com lag de mola e o grafo continua fluindo apos a
   * soltura — a sensacao fluida e rapida do Obsidian. O valor alto anterior
   * (1.0) amortecia tudo quase instantaneamente e congelava o layout antes de
   * ele relaxar. */
  velocityDecay: 0.4,
  /** Decaimento do alpha por frame (resfriamento da simulacao). Lento de
   * proposito: o layout ambiente tem TEMPO de relaxar ate o circulo estavel
   * ao redor do hub em vez de congelar no meio do caminho (o assentamento
   * real e encerrado pelo timeout ~4.5s do chamador, com o circulo formado). */
  alphaDecay: 0.99,
  /** Alpha abaixo do qual a simulacao ambiente/assentamento para. */
  alphaMin: 0.03,
  /** Centralizacao de hubs: nos com grau >= hubCenterMinDegree sao puxados ao
   * centro do grafo MESMO dentro do anel (alem da center force), com forca
   * proporcional ao grau — o no com mais conexoes fica no centro e os
   * vizinhos formam o anel (atomo/eletrons) ao redor dele, como no Obsidian. */
  hubCenterMinDegree: 4,
  /** Forca da centralizacao de hubs por unidade de distancia ao centro. */
  hubCenterStrength: 0.4,
  /** Teto de grau para o crescimento da forca de centralizacao. */
  hubCenterMaxExtraDegree: 8,
  /** Fator de crescimento da forca por conexao alem do minimo. */
  hubCenterDegreeFactor: 0.25,
  /** Raio base da colisao dos nos (unidades do mundo 0-200). Combina com a
   * folga abaixo para os nos nao encostarem (bolinha + nome abaixo). */
  collideRadiusBase: 3.0,
  /** Crescimento do raio de colisao por conexao (grau da nota), com teto.
   * Hubs grandes empurram os vizinhos para mais longe (anel maior). */
  collideRadiusPerDegree: 0.3,
  /** Teto de grau para o crescimento do raio de colisao. */
  collideRadiusMaxDegree: 8,
  /** Folga extra entre nos alem da bolinha (espaco para o nome abaixo). */
  collidePadding: 2.0,
  /** Forca da colisao por unidade de sobreposicao (d3-force collide). Forte o
   * suficiente para o anel nao "travar" com nos encostados (deslizamento
   * angular livre dos vizinhos ao redor do hub). */
  collideStrength: 3.5,
  /** Decaimento MINIMO de velocidade para a fase de ASSENTAMENTO (ambiente e
   * pos-arrasto). O arrasto usa o decay do usuario (velocityDecay, baixo para
   * fluidez); o assentamento usa max(decay do usuario, este piso) — alto para
   * a oscilacao amortecer e o layout convergir no circulo. */
  settleVelocityDecayMin: 0.8,
  /** Limite de velocidade (unidades/s): impede que a repulsao 1/d² a curta
   * distancia lance os nos a velocidades extremas no big bang — a explosao
   * controlada espalha e ASSENTA no circulo em vez de oscilar para sempre.
   * Na fluidez do arrasto, os vizinhos seguem o no arrastado com lag de mola
   * ate este teto. */
  maxVelocity: 60,
  /** Multiplicador de rigidez das arestas INCIDENTES ao no segurado pelo
   * cursor durante o ARRASTO. So a aresta do no arrastado fica mais rigida:
   * a puxada do cursor vence as molas internas do cluster (o anel de
   * vizinhos do hub equilibrava a forca e os conectados quase nao se
   * moviam) e o cluster persegue o cursor com lag elastico — o seguimento
   * rapido e fluido do Obsidian. 0 = sem boost (apenas nas fases de
   * assentamento/ambiente, onde a ponderacao por grau forma o circulo). */
  dragSpringBoost: 6,
}

/** Um passo das forcas do modelo Obsidian: repulsao 1/d² entre todos os pares
 * (moventes + fixos), molas das arestas no descanso configuravel PONDERADAS
 * pelo grau (hubs estaveis, folhas orbitam), colisao d3-force, center force
 * com zona morta e centralizacao de hubs (no com mais conexoes ao centro).
 * So acumula em velocidades (nao integra); o chamador aplica o decaimento,
 * o teto de velocidade e move.
 *
 * CONTRATO DE MOVIMENTO: um no so recebe forca (se move) se tiver uma entrada
 * no mapa de `velocities` — nos fixos (pinned) estao presentes em `positions`
 * mas sem entrada em `velocities`, entao repelem, puxam por mola e colidem
 * sem se mover. Evita alocar um Set a cada frame. */
export function accumulateObsidianForces2D(params: {
  /** Nos do conjunto (moventes + fixos). Os que tem entrada em `velocities`
   * se movem; os demais (ex.: o no arrastado durante o drag) ficam fixos. */
  paths: string[]
  positions: Map<string, NoteGraphPosition>
  velocities: Map<string, NoteGraphPosition>
  /** Arestas entre os nos do conjunto (molas no descanso configuravel). */
  edges?: NoteGraphLayoutLink[]
  /** Rigidez das molas. Padrao: OBSIDIAN_PHYSICS_2D. */
  linkStiffness?: number
  /** Descanso das molas ("Link distance" do Obsidian, em %). Padrao: 10. */
  linkRest?: number
  /** Multiplicador da repulsao (slider "Repulsion"). Padrao: 1 (base). */
  repulsionStrength?: number
  /** Raio do anel da center force. Padrao: OBSIDIAN_PHYSICS_2D. */
  centerRadius?: number
  /** Forca da center force por unidade alem do anel. Padrao: base. */
  centerStrength?: number
  /** Centros dos grupos (pasta) por caminho; quando presentes, cada no e
   * puxado para o centro do proprio grupo (agrupamento visual por pasta). */
  groupCenters?: Map<string, NoteGraphPosition>
  /** Raio interno da mola do grupo: dentro dele o no fica livre. */
  groupInnerRadius?: number
  /** Forca da mola do grupo por unidade alem do raio interno. */
  groupStrength?: number
  /** Resfriamento: 1 durante o arrasto; decai no ambiente/assentamento. */
  alpha?: number
  /** Passo de tempo em segundos. */
  delta: number
  /** Pondera as molas pelo grau (d3-force link: hubs estaveis, folhas orbitam)
   * — usado apenas no AMBIENTE, onde o anel precisa se formar. Durante o
   * ARRASTO/ASSENTAMENTO as molas sao CHEIAS nos dois extremos para o
   * cluster seguir o no arrastado com a fluidez do Obsidian. Padrao: true. */
  springBiasByDegree?: boolean
  /** Aplica a centralizacao de hubs (nos com grau >= minimo puxados ao
   * centro) — apenas no AMBIENTE, para o hub ficar central. Durante o
   * ARRASTO/ASSENTAMENTO o controle e do usuario: a centralizacao nao deve
   * puxar o hub de volta ao centro contra o arrasto. Padrao: true. */
  hubCentering?: boolean
  /** No sendo ARRASTADO (pinned): as arestas INCIDENTES a ele usam a rigidez
   * multiplicada por `dragSpringBoost`. E a alavanca que faz o cluster
   * CONECTADO acompanhar o no segurado: sem o boost, as molas internas do
   * cluster (o anel de vizinhos do hub) equilibram a puxada do no arrastado
   * e o hub quase nao se move — o "conectados se movem quase a zero" do
   * usuario. Com o boost so na aresta do no arrastado, a puxada vence o
   * equilibrio e o cluster persegue o cursor com lag elastico (Obsidian).
   * Usado apenas no ARRASTO. */
  dragAnchor?: string
  /** Multiplicador de rigidez das arestas incidentes ao `dragAnchor`.
   * Padrao: 1 (sem boost). */
  dragSpringBoost?: number
}): void {
  const { paths, positions, velocities, edges, alpha = 1, delta } = params
  const {
    linkStiffness,
    repulsionStrength,
    repulsionCutoff,
    repulsionDistanceMin,
    centerRadius,
    centerStrength,
    collideRadiusBase,
    collideRadiusPerDegree,
    collideRadiusMaxDegree,
    collidePadding,
    collideStrength,
    hubCenterMinDegree,
    hubCenterStrength,
    hubCenterMaxExtraDegree,
    hubCenterDegreeFactor,
    maxVelocity,
  } = OBSIDIAN_PHYSICS_2D
  const linkRest = params.linkRest ?? 10
  const repulsion = params.repulsionStrength ?? repulsionStrength
  const ringRadius = params.centerRadius ?? centerRadius
  const ringStrength = params.centerStrength ?? centerStrength
  const scale = alpha * delta
  const all = paths
  const count = all.length

  // Grau por no (arestas VISIVEIS): usado pela colisao (raio maior para hubs)
  // e pela centralizacao de hubs (nos com muitas conexoes puxados ao centro).
  const degree = new Map<string, number>()
  for (const edge of edges ?? []) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  // Arrays alinhados a `all` (posicao/velocidade/raio por indice): o loop de
  // pares O(n²) acessa por indice em vez de 2+ gets de Map por par — um dos
  // custos dominantes do arrasto em grafos grandes (FPS).
  const nodePositions: Array<NoteGraphPosition | undefined> = new Array(count)
  const nodeVelocities: Array<NoteGraphPosition | undefined> = new Array(count)
  const nodeRadii: number[] = new Array(count)
  for (let index = 0; index < count; index += 1) {
    nodePositions[index] = positions.get(all[index])
    nodeVelocities[index] = velocities.get(all[index])
    const degreeCount = degree.get(all[index]) ?? 0
    nodeRadii[index] = collideStrength > 0
      ? collideRadiusBase + Math.min(degreeCount, collideRadiusMaxDegree) * collideRadiusPerDegree + collidePadding
      : 0
  }

  // 1) Repulsao many-body (Coulomb, 1/d²) entre todos os pares, com cutoff, e
  // colisao (d3-force collide) para pares sobrepostos — calculadas no mesmo
  // loop O(n²) com cutoff, sem custo extra de percorrer os pares duas vezes.
  const cutoffSquared = repulsionCutoff * repulsionCutoff
  for (let left = 0; left < count; left += 1) {
    const a = nodePositions[left]
    if (!a) continue
    for (let right = left + 1; right < count; right += 1) {
      const b = nodePositions[right]
      if (!b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const distanceSquared = dx * dx + dy * dy

      // Colisao: pares mais proximos que a soma dos raios se empurram ao
      // longo da normal ate nao se sobreporem. Nos colocalizados (l = 0)
      // usam uma direcao deterministica (+x) para se separarem. Mesmo
      // contrato de movimento: so quem tem entrada em velocities se move.
      const collideRadius = nodeRadii[left] + nodeRadii[right]
      if (collideRadius > 0 && distanceSquared < collideRadius * collideRadius) {
        const distance = distanceSquared === 0 ? 0 : Math.sqrt(distanceSquared)
        const push = (collideRadius - distance) * collideStrength * scale
        const nx = distance === 0 ? 1 : dx / distance
        const ny = distance === 0 ? 0 : dy / distance
        const va = nodeVelocities[left]
        const vb = nodeVelocities[right]
        if (va) {
          va.x += nx * push
          va.y += ny * push
        }
        if (vb) {
          vb.x -= nx * push
          vb.y -= ny * push
        }
      }

      if (distanceSquared >= cutoffSquared || distanceSquared === 0) continue
      const distance = Math.sqrt(distanceSquared)
      const push = (repulsion / Math.max(distanceSquared, repulsionDistanceMin * repulsionDistanceMin)) * scale
      const nx = dx / distance
      const ny = dy / distance
      const va = nodeVelocities[left]
      const vb = nodeVelocities[right]
      if (va) {
        va.x += nx * push
        va.y += ny * push
      }
      if (vb) {
        vb.x -= nx * push
        vb.y -= ny * push
      }
    }
  }

  // 2) Molas das arestas (Hooke): puxam os extremos para o linkRest, com a
  // forca de cada extremo PONDERADA pelo grau (d3-force link). Hubs "pesados"
  // recebem menos forca por aresta e ficam estaveis; as folhas recebem a
  // forca cheia e orbitam ao redor — e o que faz o anel (atomo/eletrons) se
  // formar e o hub nao ser arrastado pelo desequilibrio das molas.
  for (const edge of edges ?? []) {
    const a = positions.get(edge.source)
    const b = positions.get(edge.target)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.max(Math.hypot(dx, dy), 0.001)
    // Boost de arrasto: a aresta incidente ao no segurado fica MAIS rigida
    // (so ela) — a puxada do cursor vence as molas internas do cluster e os
    // conectados acompanham o arrasto em vez de estacionarem.
    const isDragEdge = params.dragAnchor !== undefined
      && (edge.source === params.dragAnchor || edge.target === params.dragAnchor)
    const edgeStiffness = isDragEdge && params.dragSpringBoost !== undefined
      ? linkStiffness * params.dragSpringBoost
      : linkStiffness
    const force = (dist - linkRest) * edgeStiffness * scale
    const nx = dx / dist
    const ny = dy / dist
    const springBiasByDegree = params.springBiasByDegree ?? true
    const sourceFactor = springBiasByDegree ? 1 / Math.max(1, degree.get(edge.source) ?? 1) : 1
    const targetFactor = springBiasByDegree ? 1 / Math.max(1, degree.get(edge.target) ?? 1) : 1
    const va = velocities.get(edge.source)
    const vb = velocities.get(edge.target)
    if (va) {
      va.x += nx * force * sourceFactor
      va.y += ny * force * sourceFactor
    }
    if (vb) {
      vb.x -= nx * force * targetFactor
      vb.y -= ny * force * targetFactor
    }
  }

  // 3) Center force: puxa para o anel ao redor do centro (zona morta dentro)
  // e, para nos com muitas conexoes (hubs), puxa ao centro MESMO dentro do
  // anel com forca proporcional ao grau — o no central fica centralizado e os
  // vizinhos formam o circulo (atomo/eletrons) ao redor dele.
  for (let index = 0; index < count; index += 1) {
    const current = nodePositions[index]
    const velocity = nodeVelocities[index]
    if (!current || !velocity) continue
    const dx = GRAPH_2D_WORLD_CENTER - current.x
    const dy = GRAPH_2D_WORLD_CENTER - current.y
    const dist = Math.hypot(dx, dy)
    if (dist === 0) continue
    let pull = 0
    if (dist > ringRadius) pull += (dist - ringRadius) * ringStrength
    const degreeCount = degree.get(all[index]) ?? 0
    const hubCentering = params.hubCentering ?? true
    if (hubCentering && degreeCount >= hubCenterMinDegree) {
      pull += dist * hubCenterStrength * (1 + Math.min(degreeCount - hubCenterMinDegree, hubCenterMaxExtraDegree) * hubCenterDegreeFactor)
    }
    if (pull > 0) {
      velocity.x += (dx / dist) * pull * scale
      velocity.y += (dy / dist) * pull * scale
    }
  }

  // 4) Mola do grupo (agrupamento por pasta): cada no e puxado de volta para
  // o centro da propria pasta quando ultrapassa o raio interno — mantem os
  // clusters coesos sem travar a repulsao nem as molas das arestas.
  const groupCenters = params.groupCenters
  if (groupCenters) {
    const groupInnerRadius = params.groupInnerRadius ?? 24
    const groupStrength = params.groupStrength ?? 0.05
    for (const path of paths) {
      const current = positions.get(path)
      const velocity = velocities.get(path)
      const center = groupCenters.get(path)
      if (!current || !velocity || !center) continue
      const dx = center.x - current.x
      const dy = center.y - current.y
      const dist = Math.hypot(dx, dy)
      if (dist > groupInnerRadius) {
        const pull = (dist - groupInnerRadius) * groupStrength * scale
        velocity.x += (dx / dist) * pull
        velocity.y += (dy / dist) * pull
      }
    }
  }

  // Limite de velocidade (maxVelocity unidades/s): a repulsao 1/d² a curta
  // distancia e enorme no big bang — sem o teto, os nos atingiriam centenas
  // de unidades/s e oscilariam sem nunca assentar. Com o teto, a explosao e
  // controlada e o layout converge para o circulo. Aplica-se a TODOS (menos
  // aos fixos, sem entrada em velocities).
  const maxSpeedSquared = maxVelocity * maxVelocity
  for (let index = 0; index < count; index += 1) {
    const velocity = nodeVelocities[index]
    if (!velocity) continue
    const speedSquared = velocity.x * velocity.x + velocity.y * velocity.y
    if (speedSquared > maxSpeedSquared) {
      const velocityScale = maxVelocity / Math.sqrt(speedSquared)
      velocity.x *= velocityScale
      velocity.y *= velocityScale
    }
  }
}
