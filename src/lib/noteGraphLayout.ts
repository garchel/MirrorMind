/**
 * Fisica do grafo 2D no modelo do Obsidian (force-directed classico, como o
 * d3-force que o Obsidian usava no graph view):
 *
 * - Mola das arestas (Lei de Hooke): F = (d - linkDistance) * linkStiffness,
 *   com o descanso configuravel ("Link distance" no Obsidian);
 * - Repulsao many-body (Coulomb, inversa ao quadrado): F = -repulsion / d^2,
 *   entre TODOS os pares de nos, com cutoff de distancia (performance) e piso
 *   de distancia para nao explodir em d ~ 0;
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
 * Posicoes em % do viewBox 0-100. A funcao de forca e pura: acumula em
 * velocidades (um passo de integracao); o chamador aplica o decaimento e move.
 */
export type NoteGraphPosition = { x: number; y: number }

export type NoteGraphLayoutLink = { source: string; target: string }

/** Limites do viewBox (%), para os nos nao sairem da tela. */
export const GRAPH_2D_BOUNDS = { minX: 4, maxX: 96, minY: 5, maxY: 95 }

/** Constantes base do modelo de forcas (unidades do viewBox 0-100). */
export const OBSIDIAN_PHYSICS_2D = {
  /** Forca da mola das arestas por unidade alem do descanso (Hooke). Alta o
   * suficiente para os vizinhos seguirem o no arrastado com vivacidade. */
  linkStiffness: 2.2,
  /** Forca da repulsao many-body: forca = repulsionStrength / d^2. */
  repulsionStrength: 1600,
  /** Pares mais distantes que isso nao se repelem (cutoff de performance). */
  repulsionCutoff: 40,
  /** Piso da distancia ao quadrado para a repulsao nao explodir em d ~ 0. */
  repulsionDistanceMin: 1.5,
  /** Raio do anel da center force ao redor do centro do grafo (50, 50). */
  centerRadius: 30,
  /** Forca da center force por unidade alem do anel. */
  centerStrength: 0.06,
  /** Decaimento da velocidade por segundo (d3 velocityDecay). Suave para os
   * nos adquirirem momento durante o arrasto e continuarem fluindo apos a
   * soltura. */
  velocityDecay: 1.0,
  /** Decaimento do alpha por frame (resfriamento da simulacao). */
  alphaDecay: 0.985,
  /** Alpha abaixo do qual a simulacao ambiente/assentamento para. */
  alphaMin: 0.03,
}

/** Um passo das forcas do modelo Obsidian: repulsao 1/d² entre todos os pares
 * (moventes + fixos), molas das arestas no descanso configuravel e center
 * force com zona morta. So acumula em velocidades (nao integra); o chamador
 * aplica o decaimento e move.
 *
 * CONTRATO DE MOVIMENTO: um no so recebe forca (se move) se tiver uma entrada
 * no mapa de `velocities` — nos fixos (pinned) estao presentes em `positions`
 * mas sem entrada em `velocities`, entao repelem e puxam por mola sem se
 * mover. Evita alocar um Set a cada frame. */
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
  /** Resfriamento: 1 durante o arrasto; decai no ambiente/assentamento. */
  alpha?: number
  /** Passo de tempo em segundos. */
  delta: number
}): void {
  const { paths, positions, velocities, edges, alpha = 1, delta } = params
  const {
    linkStiffness,
    repulsionStrength,
    repulsionCutoff,
    repulsionDistanceMin,
    centerRadius,
    centerStrength,
  } = OBSIDIAN_PHYSICS_2D
  const linkRest = params.linkRest ?? 10
  const repulsion = params.repulsionStrength ?? repulsionStrength
  const ringRadius = params.centerRadius ?? centerRadius
  const ringStrength = params.centerStrength ?? centerStrength
  const scale = alpha * delta
  const all = paths

  // 1) Repulsao many-body (Coulomb, 1/d²) entre todos os pares, com cutoff.
  for (let left = 0; left < all.length; left += 1) {
    const a = positions.get(all[left])
    if (!a) continue
    for (let right = left + 1; right < all.length; right += 1) {
      const b = positions.get(all[right])
      if (!b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const distanceSquared = dx * dx + dy * dy
      if (distanceSquared >= repulsionCutoff * repulsionCutoff || distanceSquared === 0) continue
      const distance = Math.sqrt(distanceSquared)
      const push = (repulsion / Math.max(distanceSquared, repulsionDistanceMin * repulsionDistanceMin)) * scale
      const nx = dx / distance
      const ny = dy / distance
      const va = velocities.get(all[left])
      const vb = velocities.get(all[right])
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

  // 2) Molas das arestas (Hooke): puxam os extremos para o linkRest.
  for (const edge of edges ?? []) {
    const a = positions.get(edge.source)
    const b = positions.get(edge.target)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.max(Math.hypot(dx, dy), 0.001)
    const force = (dist - linkRest) * linkStiffness * scale
    const nx = dx / dist
    const ny = dy / dist
    const va = velocities.get(edge.source)
    const vb = velocities.get(edge.target)
    if (va) {
      va.x += nx * force
      va.y += ny * force
    }
    if (vb) {
      vb.x -= nx * force
      vb.y -= ny * force
    }
  }

  // 3) Center force: puxa para o anel ao redor do centro (zona morta dentro).
  for (const path of paths) {
    const current = positions.get(path)
    const velocity = velocities.get(path)
    if (!current || !velocity) continue
    const dx = 50 - current.x
    const dy = 50 - current.y
    const dist = Math.hypot(dx, dy)
    if (dist > ringRadius) {
      const pull = (dist - ringRadius) * ringStrength * scale
      velocity.x += (dx / dist) * pull
      velocity.y += (dy / dist) * pull
    }
  }
}
