import { describe, expect, it } from 'vitest'
import { buildGraphSvg, graphNodeExportColor } from './graphExport'

describe('buildGraphSvg', () => {
  const nodes = [
    { x: 100, y: 100, radius: 8, color: '#82b7f2', label: 'Quimica' },
    { x: 300, y: 240, radius: 6, color: '#5fe6b4', label: 'Fisica' },
  ]
  const links = [{ x1: 100, y1: 100, x2: 300, y2: 240, color: '#50688a' }]

  it('produz um documento SVG standalone com fundo, nos, arestas e rotulos', () => {
    const svg = buildGraphSvg({ width: 800, height: 600, nodes, links })
    expect(svg).toContain('<svg')
    expect(svg).toContain('width="800"')
    expect(svg).toContain('viewBox="0 0 800 600"')
    expect(svg).toContain('fill="#0d1117"')
    // Aresta, halo, orbe e texto do rotulo.
    expect(svg).toContain('<line x1="100.00" y1="100.00" x2="300.00" y2="240.00"')
    expect(svg).toContain('stroke="#50688a"')
    expect(svg.match(/<circle/g)?.length).toBe(4) // halo + orbe por no
    expect(svg).toContain('>Quimica</text>')
    expect(svg).toContain('>Fisica</text>')
  })

  it('inclui a legenda quando fornecida, com a cor de cada grupo', () => {
    const legend = [
      { label: 'Raiz', color: '#f2a35c' },
      { label: 'Notas', color: '#8fd6f2' },
    ]
    const svg = buildGraphSvg({ width: 400, height: 300, nodes: [], links: [], legend })
    expect(svg).toContain('>Legenda</text>')
    expect(svg).toContain('>Raiz</text>')
    expect(svg).toContain('>Notas</text>')
    expect(svg).toContain('fill="#f2a35c"')
    expect(svg).toContain('fill="#8fd6f2"')
  })

  it('escapa caracteres especiais de rotulos e títulos (XML seguro)', () => {
    const svg = buildGraphSvg({
      width: 400,
      height: 300,
      title: 'Grafo <&"das> notas',
      nodes: [{ x: 10, y: 10, radius: 4, color: '#ffffff', label: 'A & B <C>' }],
      links: [],
    })
    expect(svg).toContain('&lt;')
    expect(svg).not.toContain('<Grafo')
  })

  it('e deterministico: mesmas entradas geram o mesmo documento', () => {
    const first = buildGraphSvg({ width: 500, height: 400, nodes, links })
    const second = buildGraphSvg({ width: 500, height: 400, nodes, links })
    expect(first).toBe(second)
  })
})

describe('graphNodeExportColor', () => {
  it('prioriza nota atual e foco e usa a cor da pasta quando agrupado', () => {
    expect(graphNodeExportColor({ degree: 0, isCurrent: true, isFocused: false })).toBe('#ffc96b')
    expect(graphNodeExportColor({ degree: 0, isCurrent: false, isFocused: true })).toBe('#b5f0ff')
    expect(graphNodeExportColor({ degree: 5, isCurrent: false, isFocused: false, folderColor: '#8fd6f2' })).toBe('#8fd6f2')
  })

  it('mantem a paleta por grau quando nao ha pasta', () => {
    expect(graphNodeExportColor({ degree: 0, isCurrent: false, isFocused: false })).toBe('#93a7c4')
    expect(graphNodeExportColor({ degree: 2, isCurrent: false, isFocused: false })).toBe('#82b7f2')
    expect(graphNodeExportColor({ degree: 9, isCurrent: false, isFocused: false })).toBe('#5fe6b4')
  })
})
