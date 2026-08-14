export type Graph3DPosition = { x: number; y: number; z: number }

export type Graph3DNode = {
  relativePath: string
}

export type Graph3DLink = {
  source: string
  target: string
}

/** Fator de interpolacao da animacao de entrada "Big Bang": 0 = todos juntos
 * no centro, 1 = no layout final. Easing cubico com arranque rapido e
 * assentamento lento; nos mais distantes do centro saem na frente (a sensacao
 * de uma explosao por repulsao, sem efeitos). Converge para 1 em progresso 1
 * para qualquer distancia — o layout final e sempre exato. */
export function birthInterpolation(progress: number, distance: number, maxRadius: number): number {
  const clamped = Math.max(0, Math.min(1, progress))
  const eased = 1 - Math.pow(1 - clamped, 3)
  const speedFactor = 0.55 + 0.45 * (maxRadius > 0.001 ? distance / maxRadius : 1)
  return Math.min(1, Math.pow(eased, 1 / speedFactor))
}

/** Layout force-directed em 3D para o grafo das notas: reposicao em esfera
 * (espalhada no eixo Y), repulsao par-a-par e molas nas arestas, com gravidade
 * suave puxando tudo de volta ao centro — mesma receita do layout 2D do
 * workspace, apenas com a coordenada Z. Retorna um Map caminho -> posicao em
 * unidades de mundo (nao percentuais, como no grafo 2D).
 *
 * O parâmetro `nodeSpacing` (a configuracao "Distancia entre nos") escala o
 * layout inteiro. As constantes sao calibradas para um grafo compacto: um hub
 * com dezenas de conexoes forma um anel a ~15-20 unidades (em vez de espalhar
 * nos a 100+ unidades, como a versao anterior da repulsao fazia). */
export function createForceGraph3DLayout(
  nodes: Graph3DNode[],
  links: Graph3DLink[],
  iterations = 140,
  options?: { nodeSpacing?: number; groupOf?: (node: Graph3DNode) => string; groupSpacing?: number },
): Map<string, Graph3DPosition> {
  const scale = (options?.nodeSpacing ?? 8) / 8
  const positions = new Map<string, Graph3DPosition>()
  const groupOf = options?.groupOf
  const groupRingRadius = options?.groupSpacing ?? 16

  // Agrupamento por pasta: cada grupo ganha um centro deterministico em um
  // anel no plano XZ (alternando a altura), e cada no inicia proximo ao
  // centro do proprio grupo em um pequeno anel interno.
  const groupCenters = new Map<string, Graph3DPosition>()
  if (groupOf) {
    const groups = new Map<string, string[]>()
    for (const node of nodes) {
      const group = groupOf(node)
      const members = groups.get(group) ?? []
      members.push(node.relativePath)
      groups.set(group, members)
    }
    const groupNames = [...groups.keys()].sort((left, right) => left.localeCompare(right))
    const rootIndex = groupNames.indexOf('')
    if (rootIndex !== -1) {
      const [root] = groupNames.splice(rootIndex, 1)
      groupNames.unshift(root)
    }
    groupNames.forEach((group, groupIndex) => {
      const groupAngle = (Math.PI * 2 * groupIndex) / Math.max(groupNames.length, 1) - Math.PI / 2
      const center = {
        x: Math.cos(groupAngle) * groupRingRadius,
        y: (groupIndex % 2 === 0 ? 1 : -1) * 2.5,
        z: Math.sin(groupAngle) * groupRingRadius,
      }
      groupCenters.set(group, center)
      const members = groups.get(group) ?? []
      members.forEach((path, memberIndex) => {
        const innerAngle = (Math.PI * 2 * memberIndex) / Math.max(members.length, 1) - Math.PI / 2
        positions.set(path, {
          x: center.x + Math.cos(innerAngle) * 2.6,
          y: center.y + (memberIndex % 3) * 1.1,
          z: center.z + Math.sin(innerAngle) * 2.6,
        })
      })
    })
  } else {
    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2
      const height = nodes.length > 1 ? (index / (nodes.length - 1) - 0.5) * 13 : 0
      positions.set(node.relativePath, {
        x: Math.cos(angle) * 9,
        y: height,
        z: Math.sin(angle) * 9,
      })
    })
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const displacement = new Map<string, Graph3DPosition>()
    for (const node of nodes) displacement.set(node.relativePath, { x: 0, y: 0, z: 0 })

    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const source = positions.get(nodes[left].relativePath)!
        const target = positions.get(nodes[right].relativePath)!
        const deltaX = source.x - target.x || 0.01
        const deltaY = source.y - target.y || 0.01
        const deltaZ = source.z - target.z || 0.01
        const distanceSquared = Math.max(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ, 1)
        const force = 20 / distanceSquared
        const from = displacement.get(nodes[left].relativePath)!
        const to = displacement.get(nodes[right].relativePath)!
        from.x += deltaX * force
        from.y += deltaY * force
        from.z += deltaZ * force
        to.x -= deltaX * force
        to.y -= deltaY * force
        to.z -= deltaZ * force
      }
    }

    for (const link of links) {
      const source = positions.get(link.source)
      const target = positions.get(link.target)
      if (!source || !target) continue
      const deltaX = target.x - source.x
      const deltaY = target.y - source.y
      const deltaZ = target.z - source.z
      const distance = Math.max(Math.hypot(deltaX, deltaY, deltaZ), 1)
      const force = (distance - 11) * 0.1
      const from = displacement.get(link.source)!
      const to = displacement.get(link.target)!
      from.x += (deltaX / distance) * force
      from.y += (deltaY / distance) * force
      from.z += (deltaZ / distance) * force
      to.x -= (deltaX / distance) * force
      to.y -= (deltaY / distance) * force
      to.z -= (deltaZ / distance) * force
    }

    // Mola do grupo: cada no e puxado de volta para o centro da propria pasta
    // quando ultrapassa o raio interno — mantem os clusters coesos sem impedir
    // a repulsao par-a-par nem as arestas internas.
    if (groupOf) {
      for (const node of nodes) {
        const center = groupCenters.get(groupOf(node))
        if (!center) continue
        const position = positions.get(node.relativePath)!
        const movement = displacement.get(node.relativePath)!
        const dx = center.x - position.x
        const dy = center.y - position.y
        const dz = center.z - position.z
        const distance = Math.hypot(dx, dy, dz)
        if (distance > 3.4) {
          const pull = (distance - 3.4) * 0.09
          movement.x += (dx / distance) * pull
          movement.y += (dy / distance) * pull
          movement.z += (dz / distance) * pull
        }
      }
    }

    for (const node of nodes) {
      const position = positions.get(node.relativePath)!
      const movement = displacement.get(node.relativePath)!
      position.x += movement.x * 0.13 + -position.x * 0.07
      position.y += movement.y * 0.13 + -position.y * 0.07
      position.z += movement.z * 0.13 + -position.z * 0.07
    }
  }

  // Escala final: a configuracao "Distancia entre nos" define o tamanho do
  // grafo como um todo (preserva a forma, apenas multiplica as posicoes).
  if (scale !== 1) {
    for (const position of positions.values()) {
      position.x *= scale
      position.y *= scale
      position.z *= scale
    }
  }

  return positions
}
