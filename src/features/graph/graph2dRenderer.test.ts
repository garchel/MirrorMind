import { beforeAll, describe, expect, it, vi } from 'vitest'
import { drawGraph2d, type Graph2dRenderOptions } from './graph2dRenderer'
import { Graph2dSimulation } from '../../lib/graph2dSimulation'

// jsdom nao tem Path2D; o desenho usa para agrupar arestas.
beforeAll(() => {
  vi.stubGlobal('Path2D', class {
    moveTo() {}
    lineTo() {}
  })
})

/** Contexto 2D falso: registra o que o desenho pediu. */
function ctxFalso() {
  const gradientes: number[] = []
  const alfasNoFill: number[] = []
  const textos: string[] = []
  const espessuras: number[] = []
  const ctx = {
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() { alfasNoFill.push(Number(ctx.globalAlpha.toFixed(2))) },
    arc() {},
    fillText(t: string) { textos.push(t) },
    createRadialGradient() {
      gradientes.push(1)
      // `fill()` tambem e chamado para o glow, mas contamos a criacao.
      return { addColorStop() {} }
    },
    set strokeWidth(v: number) { espessuras.push(v) },
  }
  void espessuras
  return { ctx: ctx as unknown as CanvasRenderingContext2D, gradientes, alfasNoFill, textos }
}

const CORES = {
  link: 'rgb(1 2 3 / 40%)',
  linkDim: 'rgb(1 2 3 / 10%)',
  linkFocus: 'rgb(1 2 3 / 80%)',
  node: 'rgb(9 9 9)',
  nodeRing: 'rgb(0 0 0)',
  nodeCurrent: 'rgb(9 9 9)',
  label: 'rgb(0 0 0)',
  labelDim: 'rgb(0 0 0)',
}

function montar(hovered: number, focus: number[], intensidade: number) {
  const sim = new Graph2dSimulation({
    paths: ['a', 'b', 'c', 'd'],
    links: [{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }],
    positions: new Map([
      ['a', { x: 0, y: 0 }], ['b', { x: 250, y: 0 }], ['c', { x: 0, y: 250 }], ['d', { x: 500, y: 500 }],
    ]),
  })
  const options: Graph2dRenderOptions = {
    width: 600,
    height: 400,
    dpr: 1,
    // zoom 0.5 com centro em (250,250) deixa os 4 nos dentro da tela de
    // 600x400 — com zoom 1 metade ficava fora e o culling os descartava.
    view: { x: 250, y: 250, zoom: 0.5 },
    hovered,
    neighbors: new Set([1, 2]),
    labels: false,
    colors: CORES,
    nodeStyles: [
      { color: '#3366cc', isCurrent: false },
      { color: '#3366cc', isCurrent: false },
      { color: '#3366cc', isCurrent: false },
      { color: '#cc6633', isCurrent: false },
    ],
    nodeSizeMultiplier: 1,
    focus: Float32Array.from(focus),
    focusIntensity: intensidade,
  }
  return { sim, options }
}

describe('drawGraph2d — glow do conjunto em hover', () => {
  it('sem hover nao desenha glow nenhum', () => {
    const { sim, options } = montar(-1, [0, 0, 0, 0], 0)
    const { ctx, gradientes } = ctxFalso()
    drawGraph2d(ctx, sim, options)
    expect(gradientes.length).toBe(0)
  })

  it('com hover, so os nos do conjunto ganham glow', () => {
    const { sim, options } = montar(0, [1, 1, 1, 0], 1)
    const { ctx, gradientes } = ctxFalso()
    drawGraph2d(ctx, sim, options)
    // a, b e c estao no conjunto; d nao.
    expect(gradientes.length).toBe(3)
  })

  it('o glow entra e sai pelo peso (sem corte seco)', () => {
    const meio = montar(0, [0.5, 0.5, 0.5, 0], 0.5)
    const { ctx, gradientes } = ctxFalso()
    drawGraph2d(ctx, meio.sim, meio.options)
    // Peso 0.5 ainda desenha glow (acima do corte de 0.02), mas so nos 3.
    expect(gradientes.length).toBe(3)

    const quaseZero = montar(0, [0.01, 0.01, 0.01, 0], 0.01)
    const c2 = ctxFalso()
    drawGraph2d(c2.ctx, quaseZero.sim, quaseZero.options)
    expect(c2.gradientes.length).toBe(0)
  })

  it('quem esta fora do conjunto escurece conforme a intensidade', () => {
    const { sim, options } = montar(0, [1, 1, 1, 0], 1)
    const { ctx, alfasNoFill } = ctxFalso()
    drawGraph2d(ctx, sim, options)
    // Os 3 destacados saem com alfa 1; o no de fora com 1 - 0.66.
    expect(alfasNoFill).toContain(1)
    expect(alfasNoFill.some((a) => Math.abs(a - 0.34) < 0.02)).toBe(true)
  })

  it('no hover, os rotulos sao so do conjunto', () => {
    const { sim, options } = montar(0, [1, 1, 1, 0], 1)
    const { ctx, textos } = ctxFalso()
    drawGraph2d(ctx, sim, options)
    expect(textos).toEqual(['a', 'b', 'c'])
  })

  it('sem hover e com zoom acima do limiar, mostra todos os nomes', () => {
    const { sim, options } = montar(-1, [0, 0, 0, 0], 0)
    const { ctx, textos } = ctxFalso()
    drawGraph2d(ctx, sim, { ...options, labels: true })
    expect(textos).toEqual(['a', 'b', 'c', 'd'])
  })
})
