/** Helpers puros de agrupamento do grafo por PASTA ou por TAG: chave do grupo,
 * paleta deterministica, cores com override por Vault, grupos ordenados e
 * entrada de legenda. Tanto o grafo 2D quanto o 3D consomem estas funcoes, de
 * modo que a cor de um grupo e identica nas duas representacoes. */

export type GraphGroupKind = 'folder' | 'tag'

export type GraphGroup = {
  /** Chave do grupo: caminho da pasta ('' = raiz) ou tag (sem '#'). */
  key: string
  /** Rotulo da legenda ("Raiz", caminho, "#tag" ou "Sem tag"). */
  label: string
  /** Cor do grupo (override do Vault ou paleta deterministica). */
  color: string
  /** Caminhos das notas do grupo. */
  paths: string[]
}

/** Pasta de uma nota: o diretorio pai relativo ao vault, ou '' para a raiz. */
export function folderOf(relativePath: string): string {
  const separatorIndex = relativePath.lastIndexOf('/')
  return separatorIndex <= 0 ? '' : relativePath.slice(0, separatorIndex)
}

/** Paleta fixa e ordenada de cores por grupo (pasta ou tag). Cores com bom
 * contraste sobre o fundo escuro do grafo 3D (navy) e sobre o fundo claro do
 * grafo 2D. */
export const GRAPH_FOLDER_PALETTE: readonly string[] = [
  '#f2a35c', // laranja
  '#8fd6f2', // azul claro
  '#a8e6a3', // verde claro
  '#f2c96b', // amarelo
  '#c9a8f2', // lilas
  '#f28cb0', // rosa
  '#8fd9c3', // verde-aguamarina
  '#b0b8f2', // azul-pervane
  '#e6b37a', // damasco
  '#9ad1f0', // celeste
  '#d9c76b', // mostarda
  '#c3a8e0', // lavanda
  '#f0a9a9', // coral claro
  '#9fc4a0', // verde-salgueiro
]

/** Rotulo de um grupo de pasta na legenda: nome da pasta ou "Raiz" para notas
 * na raiz do vault. */
export function folderGroupLabel(folder: string): string {
  return folder === '' ? 'Raiz' : folder
}

/** Rotulo de um grupo de tag na legenda: "#tag" ou "Sem tag" para notas sem
 * tag. */
export function tagGroupLabel(tag: string): string {
  return tag === '' ? 'Sem tag' : `#${tag}`
}

/** Cor deterministica de um grupo (pasta ou tag) com override por Vault:
 * `overrides[key]` quando presente; senao a paleta indexada pela ordem
 * ordenada dos grupos (estavel entre renders), com repeticao ciclica. */
export function groupColor(
  key: string,
  sortedGroupIndex: number,
  overrides?: Readonly<Record<string, string>>,
): string {
  const override = overrides?.[key]
  if (override && /^#[0-9a-fA-F]{6}$/.test(override)) return override
  return GRAPH_FOLDER_PALETTE[sortedGroupIndex % GRAPH_FOLDER_PALETTE.length]
}

/** Cor deterministica de uma pasta: indexada pela ordem ordenada das pastas
 * (estavel entre renders) sobre a paleta, com repeticao ciclica. */
export function folderColor(sortedFolderIndex: number): string {
  return GRAPH_FOLDER_PALETTE[sortedFolderIndex % GRAPH_FOLDER_PALETTE.length]
}

export type GraphFolderGroup = GraphGroup & { folder: string }

/** Tag principal de uma nota para o agrupamento por tag: a `primaryTag`
 * configurada quando a nota a possui; senao a PRIMEIRA tag extraida da nota
 * (o extrator ordena alfabeticamente, entao e a primeira nessa ordem); notas
 * sem tag ficam no grupo vazio ("Sem tag"). */
export function primaryTagFor(
  tags: readonly string[],
  primaryTag?: string,
): string {
  if (tags.length === 0) return ''
  if (primaryTag && tags.includes(primaryTag)) return primaryTag
  return tags[0]
}

export type GraphGroupOptions = {
  kind: GraphGroupKind
  /** Pasta de uma nota (padrao: `folderOf`). */
  folderOfPath?: (relativePath: string) => string
  /** Tags de uma nota (obrigatorio para agrupamento por tag). */
  tagsOfPath?: (relativePath: string) => string[]
  /** Tag principal opcional para desempatar notas com varias tags. */
  primaryTag?: string
  /** Overrides de cor por chave de grupo, persistidos por Vault. */
  colorOverrides?: Readonly<Record<string, string>>
}

/** Agrupa nos por pasta ou por tag em ordem deterministica (grupo vazio
 * primeiro, depois ordem alfabetica), atribuindo a cor estavel de cada grupo. */
export function buildGraphGroups(
  nodes: ReadonlyArray<{ relativePath: string }>,
  options: GraphGroupOptions,
): GraphGroup[] {
  const groupFolder = options.folderOfPath ?? folderOf
  const byKey = new Map<string, string[]>()
  for (const node of nodes) {
    const key = options.kind === 'folder'
      ? groupFolder(node.relativePath)
      : primaryTagFor(options.tagsOfPath?.(node.relativePath) ?? [], options.primaryTag)
    const paths = byKey.get(key) ?? []
    paths.push(node.relativePath)
    byKey.set(key, paths)
  }
  const keys = [...byKey.keys()].sort((left, right) => {
    if (left === '') return -1
    if (right === '') return 1
    return left.localeCompare(right)
  })
  return keys.map((key, index) => {
    const label = options.kind === 'folder'
      ? folderGroupLabel(key)
      : tagGroupLabel(key)
    return {
      key,
      label,
      color: groupColor(key, index, options.colorOverrides),
      paths: byKey.get(key) ?? [],
    }
  })
}

/** Agrupa nos por pasta em ordem deterministica (pasta vazia primeiro, depois
 * ordem alfabetica), atribuindo a cor estavel de cada grupo. */
export function buildFolderGroups(
  nodes: ReadonlyArray<{ relativePath: string }>,
  options?: { folderOfPath?: (relativePath: string) => string },
): GraphFolderGroup[] {
  return buildGraphGroups(nodes, { kind: 'folder', folderOfPath: options?.folderOfPath }).map(
    (group) => ({ ...group, folder: group.key }),
  )
}

/** Centros dos grupos no espaco do grafo 2D (percentuais 0-100): anel ao
 * redor do centro, raio crescendo com o numero de grupos — usado pela mola
 * de grupo da fisica 2D. Map caminho -> centro do proprio grupo. */
export function buildGraph2dGroupCentersForGroups(
  groups: readonly GraphGroup[],
): Map<string, { x: number; y: number }> {
  const centers = new Map<string, { x: number; y: number }>()
  const radius = Math.min(34, 20 + groups.length * 1.4)
  groups.forEach((group, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(groups.length, 1) - Math.PI / 2
    const center = {
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
    }
    for (const path of group.paths) centers.set(path, center)
  })
  return centers
}

/** Centros dos grupos de PASTA para a mola da fisica 2D (compatibilidade com a
 * API anterior). */
export function buildGraph2dGroupCenters(
  nodes: ReadonlyArray<{ relativePath: string }>,
): Map<string, { x: number; y: number }> {
  return buildGraph2dGroupCentersForGroups(buildFolderGroups(nodes))
}

/** Mapas prontos para o consumo dos grafos (2D e 3D): grupos, chave por
 * caminho e cor por chave/caminho, com overrides de cor do Vault aplicados. */
export function buildGroupMaps(
  nodes: ReadonlyArray<{ relativePath: string }>,
  options: GraphGroupOptions,
): {
  groups: GraphGroup[]
  groupByPath: Record<string, string>
  groupColorByPath: Record<string, string>
  groupColorByKey: Record<string, string>
} {
  const groups = buildGraphGroups(nodes, options)
  const groupByPath: Record<string, string> = {}
  const groupColorByPath: Record<string, string> = {}
  const groupColorByKey: Record<string, string> = {}
  for (const node of nodes) {
    const key = options.kind === 'folder'
      ? (options.folderOfPath ?? folderOf)(node.relativePath)
      : primaryTagFor(options.tagsOfPath?.(node.relativePath) ?? [], options.primaryTag)
    groupByPath[node.relativePath] = key
  }
  for (const group of groups) {
    groupColorByKey[group.key] = group.color
    // Cor por CHAVE de grupo (pasta ou tag), consumida pelos grafos 2D/3D e
    // pela legenda — nao por caminho de nota.
    groupColorByPath[group.key] = group.color
  }
  return { groups, groupByPath, groupColorByPath, groupColorByKey }
}

/** Mapas prontos para o consumo dos grafos: pasta por caminho e cor por
 * pasta (mesma ordem estavel de buildFolderGroups). */
export function buildFolderMaps(
  nodes: ReadonlyArray<{ relativePath: string }>,
  options?: { folderOfPath?: (relativePath: string) => string },
): {
  groups: GraphFolderGroup[]
  folderByPath: Record<string, string>
  folderColorByPath: Record<string, string>
} {
  const maps = buildGroupMaps(nodes, { kind: 'folder', folderOfPath: options?.folderOfPath })
  return {
    groups: maps.groups.map((group) => ({ ...group, folder: group.key })),
    folderByPath: maps.groupByPath,
    folderColorByPath: maps.groupColorByPath,
  }
}
