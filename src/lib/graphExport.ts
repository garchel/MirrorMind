/** Exportacao do grafo como SVG vetorial ou PNG rasterizado localmente (sem
 * servico externo). O SVG e construido de forma deterministica a partir das
 * posicoes projetadas (2D) ou da cena 3D (projecao da camera), com fundo
 * escuro, arestas, nos e rotulos — e o PNG reutiliza o mesmo SVG desenhado
 * em um canvas em resolucao configuravel. */

export type GraphExportNode = {
  /** Posicao em pixels (origem no canto superior esquerdo). */
  x: number
  y: number
  /** Raio do orbe em pixels. */
  radius: number
  /** Cor final do no (hex). */
  color: string
  /** Rotulo (nome da nota, sem extensao). */
  label: string
}

export type GraphExportLink = {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
}

export type GraphExportLegendEntry = {
  label: string
  color: string
}

export type GraphExportOptions = {
  width: number
  height: number
  nodes: GraphExportNode[]
  links: GraphExportLink[]
  /** Entradas da legenda (agrupamento por pasta ativo). */
  legend?: GraphExportLegendEntry[]
  /** Cor do fundo. Padrao: navy do grafo 3D. */
  backgroundColor?: string
  /** Titulo do documento. */
  title?: string
}

const DEFAULT_BACKGROUND = '#0d1117'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Constroi um SVG standalone (fundo, arestas, nos com brilho sutil, rotulos
 * e legenda opcional). Deterministico: mesmas entradas, mesmo documento. */
export function buildGraphSvg(options: GraphExportOptions): string {
  const { width, height, nodes, links, legend = [], backgroundColor = DEFAULT_BACKGROUND } = options
  const body: string[] = []

  for (const link of links) {
    body.push(
      `<line x1="${link.x1.toFixed(2)}" y1="${link.y1.toFixed(2)}" x2="${link.x2.toFixed(2)}" y2="${link.y2.toFixed(2)}" stroke="${escapeXml(link.color)}" stroke-opacity="0.75" stroke-width="1" />`,
    )
  }

  for (const node of nodes) {
    // Halo suave atras do orbe (raio 3.2x, opacidade baixa).
    body.push(
      `<circle cx="${node.x.toFixed(2)}" cy="${node.y.toFixed(2)}" r="${(node.radius * 3.2).toFixed(2)}" fill="${escapeXml(node.color)}" fill-opacity="0.16" />`,
    )
    body.push(
      `<circle cx="${node.x.toFixed(2)}" cy="${node.y.toFixed(2)}" r="${node.radius.toFixed(2)}" fill="${escapeXml(node.color)}" stroke="rgba(255,255,255,0.55)" stroke-width="0.6" />`,
    )
    if (node.label) {
      body.push(
        `<text x="${node.x.toFixed(2)}" y="${(node.y + node.radius + 13).toFixed(2)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#c7d4e4">${escapeXml(node.label)}</text>`,
      )
    }
  }

  if (legend.length > 0) {
    const legendX = 16
    let legendY = 20
    body.push(
      `<rect x="${legendX - 8}" y="${legendY - 14}" width="186" height="${(legend.length * 20 + 10).toFixed(0)}" rx="8" fill="rgba(13,17,23,0.82)" stroke="rgba(255,255,255,0.14)" />`,
    )
    body.push(
      `<text x="${legendX}" y="${legendY}" font-family="system-ui, sans-serif" font-size="10" font-weight="600" fill="#e8eef6">Legenda</text>`,
    )
    legendY += 18
    for (const entry of legend) {
      body.push(
        `<circle cx="${legendX + 3}" cy="${legendY - 4}" r="4.5" fill="${escapeXml(entry.color)}" />`,
        `<text x="${legendX + 14}" y="${legendY}" font-family="system-ui, sans-serif" font-size="11" fill="#c7d4e4">${escapeXml(entry.label)}</text>`,
      )
      legendY += 20
    }
  }

  const titleTag = options.title ? `<title>${escapeXml(options.title)}</title>` : ''
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    titleTag,
    `<rect width="${width}" height="${height}" fill="${escapeXml(backgroundColor)}" />`,
    ...body,
    `</svg>`,
  ].join('\n')
}

function triggerDownload(dataUrl: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Baixa o SVG como arquivo .svg. */
export function downloadSvg(svg: string, filename: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    triggerDownload(url, filename)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

/** Rasteriza o SVG em um canvas local e baixa como .png na resolucao
 * escolhida (scale = multiplicador dos pixels do documento). Retorna false
 * quando o canvas nao esta disponivel (ex.: jsdom). */
export async function downloadPng(svg: string, filename: string, scale: number): Promise<boolean> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return false

  const widthMatch = /<svg[^>]*\swidth="(\d+)"/.exec(svg)
  const heightMatch = /<svg[^>]*\sheight="(\d+)"/.exec(svg)
  const baseWidth = widthMatch ? Number(widthMatch[1]) : 1200
  const baseHeight = heightMatch ? Number(heightMatch[1]) : 800
  const pixelScale = Math.max(1, Math.min(4, scale))
  canvas.width = Math.round(baseWidth * pixelScale)
  canvas.height = Math.round(baseHeight * pixelScale)

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Não foi possível rasterizar o grafo exportado.'))
      image.src = url
    })
    context.fillStyle = '#0d1117'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    triggerDownload(dataUrl, filename)
    return true
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}

/** Cor de um no para a exportacao do grafo 2D: pasta quando agrupado, senao a
 * mesma paleta por grau usada no grafo 3D (consistencia visual entre modos). */
export function graphNodeExportColor(params: {
  degree: number
  isCurrent: boolean
  isFocused: boolean
  folderColor?: string | null
}): string {
  const { degree, isCurrent, isFocused, folderColor } = params
  if (isCurrent) return '#ffc96b'
  if (isFocused) return '#b5f0ff'
  if (folderColor) return folderColor
  if (degree === 0) return '#93a7c4'
  if (degree <= 2) return '#82b7f2'
  return '#5fe6b4'
}
