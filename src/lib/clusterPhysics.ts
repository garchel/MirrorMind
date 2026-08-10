/** Fisica pura do cluster do grafo 3D: um no ancora fixo (o arrastado) e um
 * conjunto de nos que se movem livremente em resposta a forcas — mola da
 * aresta para o ancora (descanso = distancia original), repulsao do ancora,
 * repulsao par-a-par entre os nos e molas das arestas internas do cluster.
 *
 * `accumulateClusterForces` apenas soma as forcas em `velocities` (um passo de
 * integracao); o chamador aplica o amortecimento e move os nos. Os valores
 * sao estruturais ({ x, y, z }), compativeis com THREE.Vector3. */
export type Vec3 = { x: number; y: number; z: number }

export const CLUSTER_PHYSICS = {
  /** Rigidez das molas (aresta->ancora e arestas internas). */
  springStiffness: 12,
  /** Amortecimento da velocidade por segundo. */
  damping: 4.6,
  /** Raio de influencia da repulsao entre nos (unidades 3D). */
  repulseRadius: 6,
  /** Forca maxima da repulsao par-a-par (decaimento linear). */
  repulseStrength: 12,
  /** Descanso das molas das arestas internas do cluster. */
  edgeRestLength: 7,
  /** Arestas mais longas que isso sao puxadas com forca forte, garantindo que
   * as interacoes (repulsao/orbita) ocorram num raio limitado. */
  maxEdgeLength: 14,
  /** Rigidez da puxada alem do comprimento maximo de aresta. */
  maxEdgeStiffness: 26,
  /** Arestas mais curtas que isso sao empurradas, evitando que nos conectados
   * colapsem uns sobre os outros (orbita/arrasto). */
  minEdgeLength: 2.5,
  /** Rigidez da puxada abaixo do comprimento minimo de aresta. */
  minEdgeStiffness: 26,
}

/** Fisica orbital pos-arrasto: os nos com menos conexoes orbitam o elemento
 * com mais conexoes (nucleo) em orbitas esfericas — cada eletron orbita num
 * plano com inclinacao propria (distribuida pela esfera) que PRECESSA
 * lentamente ao redor do eixo vertical, fazendo o conjunto varrer uma casca
 * esferica (3D) em vez de circulos chapados. Os eletrons repelem-se entre si. */
export const ORBIT_PHYSICS = {
  /** Rigidez da mola que leva o eletron ao ponto da orbita. */
  springStiffness: 10,
  /** Amortecimento da velocidade por segundo. */
  damping: 4.6,
  /** Raio de influencia da repulsao entre eletrons. */
  repulseRadius: 3.5,
  /** Forca maxima da repulsao par-a-par entre eletrons. */
  repulseStrength: 16,
  /** Arestas mais longas que isso sao puxadas de volta (garante a interacao). */
  maxEdgeLength: 14,
  /** Rigidez da puxada alem do comprimento maximo de aresta. */
  maxEdgeStiffness: 26,
  /** Arestas mais curtas que isso sao empurradas (nos conectados nao colam). */
  minEdgeLength: 2.5,
  /** Rigidez da puxada abaixo do comprimento minimo de aresta. */
  minEdgeStiffness: 26,
  /** Limites do raio orbital (unidades 3D). */
  minRadius: 3.5,
  maxRadius: 10,
  /** Velocidade angular base (rad/s); orbitas externas giram mais devagar. */
  baseSpeed: 0.9,
  /** Precessao do plano orbital: velocidade = angularSpeed * precessionRatio.
   * O plano gira lentamente em torno do eixo vertical, entao cada eletron
   * varre uma faixa da esfera em vez de um circulo fixo. */
  precessionRatio: 0.22,
}

export type OrbitElectronState = {
  path: string
  /** Raio da orbita (distancia ao nucleo). */
  radius: number
  /** Angulo atual da orbita (radianos). */
  angle: number
  /** Velocidade angular (rad/s). */
  angularSpeed: number
  /** Inclinacao do plano orbital em relacao ao eixo vertical (rad). */
  inclination: number
  /** Azimute atual do plano orbital (rad); avanca com a precessao. */
  azimuth: number
  /** Velocidade de precessao do plano orbital (rad/s). */
  precessionSpeed: number
  /** Velocidade residual (transicao suave e perturbacoes). */
  velocity: Vec3
}

/** Ponto da orbita de um eletron: nucleo + raio * (cos(angle)*u + sin(angle)*t),
 * onde u/t sao a base ortonormal do plano orbital. O plano e perpendicular ao
 * normal (inclinacao/azimute); a precessao gira o azimute ao longo do tempo. */
export function computeOrbitTarget(
  nucleus: Vec3,
  electron: Pick<OrbitElectronState, 'radius' | 'angle' | 'inclination' | 'azimuth'>,
): Vec3 {
  const { radius, angle, inclination, azimuth } = electron
  const normal = {
    x: Math.sin(inclination) * Math.cos(azimuth),
    y: Math.cos(inclination),
    z: Math.sin(inclination) * Math.sin(azimuth),
  }
  // u = cross(eixoY, normal), perpendicular ao normal; t completa a base.
  const rawU = { x: normal.z, y: 0, z: -normal.x }
  const length = Math.hypot(rawU.x, rawU.y, rawU.z)
  const u = length < 0.001 ? { x: 1, y: 0, z: 0 } : { x: rawU.x / length, y: 0, z: rawU.z / length }
  const t = {
    x: normal.y * u.z - normal.z * u.y,
    y: normal.z * u.x - normal.x * u.z,
    z: normal.x * u.y - normal.y * u.x,
  }
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: nucleus.x + radius * (cosine * u.x + sine * t.x),
    y: nucleus.y + radius * (cosine * u.y + sine * t.y),
    z: nucleus.z + radius * (cosine * u.z + sine * t.z),
  }
}

export type ClusterForceParams = {
  /** Posicao do ancora (fixo, nao recebe forcas). */
  anchor: Vec3
  /** Nos que se movem (exclui o ancora). */
  paths: string[]
  positions: Map<string, Vec3>
  /** Velocidades acumuladas (mutadas por este passo). */
  velocities: Map<string, Vec3>
  /** Descanso da mola da aresta de cada no para o ancora. */
  restDistances: Map<string, number>
  /** Fator de decaimento por salto (BFS): 1o salto puxa mais. */
  factors: Map<string, number>
  /** Arestas internas do cluster (entre nos movidos). */
  internalEdges: [string, string][]
  /** Arestas com pelo menos um extremo no cluster: alem do comprimento
   * maximo, os extremos que se movem sao puxados de volta. */
  maxEdgePairs?: [string, string][]
  /** Comprimento maximo de aresta (configuravel). Padrao: CLUSTER_PHYSICS. */
  maxEdgeLength?: number
  /** Comprimento minimo de aresta (configuravel). Padrao: CLUSTER_PHYSICS. */
  minEdgeLength?: number
  /** Passo de tempo em segundos. */
  delta: number
}

export function accumulateClusterForces(params: ClusterForceParams): void {
  const { anchor, paths, positions, velocities, restDistances, factors, internalEdges, maxEdgePairs, maxEdgeLength: maxEdgeLengthParam, minEdgeLength: minEdgeLengthParam, delta } = params
  const { springStiffness, repulseRadius, repulseStrength, edgeRestLength } = CLUSTER_PHYSICS

  // 1) Mola da aresta + repulsao em relacao ao ancora.
  for (const path of paths) {
    const current = positions.get(path)
    const velocity = velocities.get(path)
    if (!current || !velocity) continue
    const dx = anchor.x - current.x
    const dy = anchor.y - current.y
    const dz = anchor.z - current.z
    const distance = Math.max(Math.hypot(dx, dy, dz), 0.001)
    const spring = (distance - (restDistances.get(path) ?? 2)) * springStiffness * (factors.get(path) ?? 1)
    const repulse = distance < repulseRadius ? (repulseRadius - distance) * repulseStrength : 0
    const force = (spring + repulse) / distance
    velocity.x += dx * force * delta
    velocity.y += dy * force * delta
    velocity.z += dz * force * delta
  }

  // 2) Repulsao par-a-par entre os nos do cluster (evita sobreposicao).
  for (let left = 0; left < paths.length; left += 1) {
    const a = positions.get(paths[left])
    const va = velocities.get(paths[left])
    if (!a || !va) continue
    for (let right = left + 1; right < paths.length; right += 1) {
      const b = positions.get(paths[right])
      if (!b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dz = a.z - b.z
      const dist = Math.hypot(dx, dy, dz)
      if (dist >= repulseRadius || dist < 0.001) continue
      const push = ((repulseRadius - dist) / repulseRadius) * repulseStrength * delta
      const nx = dx / dist
      const ny = dy / dist
      const nz = dz / dist
      const vb = velocities.get(paths[right])!
      va.x += nx * push
      va.y += ny * push
      va.z += nz * push
      vb.x -= nx * push
      vb.y -= ny * push
      vb.z -= nz * push
    }
  }

  // 3) Molas das arestas internas do cluster (preservam a forma da rede).
  for (const [u, v] of internalEdges) {
    const a = positions.get(u)
    const b = positions.get(v)
    const va = velocities.get(u)
    const vb = velocities.get(v)
    if (!a || !b || !va || !vb) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const dist = Math.max(Math.hypot(dx, dy, dz), 0.001)
    const spring = (dist - edgeRestLength) * springStiffness * delta
    const nx = dx / dist
    const ny = dy / dist
    const nz = dz / dist
    va.x += nx * spring
    va.y += ny * spring
    va.z += nz * spring
    vb.x -= nx * spring
    vb.y -= ny * spring
    vb.z -= nz * spring
  }

  // 4) Comprimento maximo de aresta: extremos muito distantes sao puxados de
  // volta com forca forte (apenas os nos que se movem recebem velocidade).
  const { maxEdgeLength: defaultMaxEdgeLength, maxEdgeStiffness } = CLUSTER_PHYSICS
  const maxEdgeLength = maxEdgeLengthParam ?? defaultMaxEdgeLength
  for (const [u, v] of maxEdgePairs ?? []) {
    const a = positions.get(u)
    const b = positions.get(v)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const dist = Math.hypot(dx, dy, dz)
    if (dist <= maxEdgeLength) continue
    const force = (dist - maxEdgeLength) * maxEdgeStiffness * delta
    const nx = dx / dist
    const ny = dy / dist
    const nz = dz / dist
    const va = velocities.get(u)
    const vb = velocities.get(v)
    if (va) {
      va.x += nx * force
      va.y += ny * force
      va.z += nz * force
    }
    if (vb) {
      vb.x -= nx * force
      vb.y -= ny * force
      vb.z -= nz * force
    }
  }

  // 5) Comprimento minimo de aresta: extremos muito proximos sao empurrados,
  // evitando que nos conectados colapsem uns sobre os outros.
  const { minEdgeLength: defaultMinEdgeLength, minEdgeStiffness } = CLUSTER_PHYSICS
  const minEdgeLength = minEdgeLengthParam ?? defaultMinEdgeLength
  for (const [u, v] of maxEdgePairs ?? []) {
    const a = positions.get(u)
    const b = positions.get(v)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const dist = Math.hypot(dx, dy, dz)
    if (dist >= minEdgeLength || dist < 0.001) continue
    const push = (minEdgeLength - dist) * minEdgeStiffness * delta
    const nx = dx / dist
    const ny = dy / dist
    const nz = dz / dist
    const va = velocities.get(u)
    const vb = velocities.get(v)
    // Empurra: a afasta de b e b afasta de a.
    if (va) {
      va.x -= nx * push
      va.y -= ny * push
      va.z -= nz * push
    }
    if (vb) {
      vb.x += nx * push
      vb.y += ny * push
      vb.z += nz * push
    }
  }
}

/** Um passo da fisica orbital (organizacao tipo atomo): avanca o angulo de
 * cada eletron, aplica a mola para o ponto da orbita ao redor do nucleo
 * (fixo), a repulsao par-a-par entre eletrons e a puxada de comprimento
 * maximo de aresta. As forcas sao acumuladas em `electron.velocity`; o
 * chamador aplica amortecimento e move os nos. */
export function accumulateOrbitForces(params: {
  /** Posicao do nucleo (o elemento com mais conexoes; permanece fixo). */
  nucleus: Vec3
  electrons: OrbitElectronState[]
  positions: Map<string, Vec3>
  /** Arestas do cluster (comprimento maximo). */
  edges: [string, string][]
  /** Comprimento maximo de aresta (configuravel). Padrao: ORBIT_PHYSICS. */
  maxEdgeLength?: number
  /** Comprimento minimo de aresta (configuravel). Padrao: ORBIT_PHYSICS. */
  minEdgeLength?: number
  /** Passo de tempo em segundos. */
  delta: number
}): void {
  const { nucleus, electrons, positions, edges, maxEdgeLength: maxEdgeLengthParam, minEdgeLength: minEdgeLengthParam, delta } = params
  const { springStiffness, repulseRadius, repulseStrength, maxEdgeLength: defaultMaxEdgeLength, maxEdgeStiffness } = ORBIT_PHYSICS
  const maxEdgeLength = maxEdgeLengthParam ?? defaultMaxEdgeLength

  // 1) Avanca o angulo e o azimute (precessao) e aplica a mola para o ponto
  // da orbita — cujo plano gira ao longo do tempo, varrendo a esfera.
  for (const electron of electrons) {
    electron.angle += electron.angularSpeed * delta
    electron.azimuth += electron.precessionSpeed * delta
    const position = positions.get(electron.path)
    const velocity = electron.velocity
    if (!position) continue
    const target = computeOrbitTarget(nucleus, electron)
    velocity.x += (target.x - position.x) * springStiffness * delta
    velocity.y += (target.y - position.y) * springStiffness * delta
    velocity.z += (target.z - position.z) * springStiffness * delta
  }

  // 2) Repulsao par-a-par entre eletrons (nao colidem na mesma orbita).
  for (let left = 0; left < electrons.length; left += 1) {
    const a = positions.get(electrons[left].path)
    const va = electrons[left].velocity
    if (!a) continue
    for (let right = left + 1; right < electrons.length; right += 1) {
      const b = positions.get(electrons[right].path)
      if (!b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const dz = a.z - b.z
      const dist = Math.hypot(dx, dy, dz)
      if (dist >= repulseRadius || dist < 0.001) continue
      const push = ((repulseRadius - dist) / repulseRadius) * repulseStrength * delta
      const nx = dx / dist
      const ny = dy / dist
      const nz = dz / dist
      const vb = electrons[right].velocity
      va.x += nx * push
      va.y += ny * push
      va.z += nz * push
      vb.x -= nx * push
      vb.y -= ny * push
      vb.z -= nz * push
    }
  }

  // 3) Comprimento maximo de aresta: extremos distantes sao puxados de volta.
  const electronByPath = new Map(electrons.map((electron) => [electron.path, electron]))
  for (const [u, v] of edges) {
    const a = positions.get(u)
    const b = positions.get(v)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const dist = Math.hypot(dx, dy, dz)
    if (dist <= maxEdgeLength) continue
    const force = (dist - maxEdgeLength) * maxEdgeStiffness * delta
    const nx = dx / dist
    const ny = dy / dist
    const nz = dz / dist
    const eu = electronByPath.get(u)
    const ev = electronByPath.get(v)
    if (eu) {
      eu.velocity.x += nx * force
      eu.velocity.y += ny * force
      eu.velocity.z += nz * force
    }
    if (ev) {
      ev.velocity.x -= nx * force
      ev.velocity.y -= ny * force
      ev.velocity.z -= nz * force
    }
  }

  // 4) Comprimento minimo de aresta: extremos muito proximos sao empurrados.
  const { minEdgeLength: defaultMinEdgeLength, minEdgeStiffness } = ORBIT_PHYSICS
  const minEdgeLength = minEdgeLengthParam ?? defaultMinEdgeLength
  for (const [u, v] of edges) {
    const a = positions.get(u)
    const b = positions.get(v)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dz = b.z - a.z
    const dist = Math.hypot(dx, dy, dz)
    if (dist >= minEdgeLength || dist < 0.001) continue
    const push = (minEdgeLength - dist) * minEdgeStiffness * delta
    const nx = dx / dist
    const ny = dy / dist
    const nz = dz / dist
    const eu = electronByPath.get(u)
    const ev = electronByPath.get(v)
    if (eu) {
      eu.velocity.x -= nx * push
      eu.velocity.y -= ny * push
      eu.velocity.z -= nz * push
    }
    if (ev) {
      ev.velocity.x += nx * push
      ev.velocity.y += ny * push
      ev.velocity.z += nz * push
    }
  }
}
