import { describe, expect, it } from 'vitest'
import { buildReadFindIndex, findReadMatches } from './readFind'

function element(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  return container
}

describe('buildReadFindIndex', () => {
  it('concatena nos inline sem separador (strong + texto)', () => {
    const { text } = buildReadFindIndex(element('<p><strong>Energia</strong> cinetica</p>'))
    expect(text).toBe('Energia cinetica')
  })

  it('insere espaco entre blocos (paragrafos e listas)', () => {
    const { text } = buildReadFindIndex(element('<p>fotossintese</p><p>cloroplasto</p><ul><li>tilacoide</li><li>estroma</li></ul>'))
    expect(text).toBe('fotossintese cloroplasto tilacoide estroma')
  })

  it('preserva a faixa de cada no de texto', () => {
    const { nodes, text } = buildReadFindIndex(element('<p>ab</p><p>cd</p>'))
    expect(text).toBe('ab cd')
    expect(nodes.map(({ start, end }) => [start, end])).toEqual([[0, 2], [3, 5]])
  })
})

describe('findReadMatches', () => {
  it('encontra correspondencias simples por paragrafo', () => {
    const root = element('<p>A energia luminosa alimenta a fotossintese.</p>')
    const matches = findReadMatches(root, 'energia')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.start).toBe(2)
    expect(matches[0]!.end).toBe(9)
  })

  it('e insensivel a caixa', () => {
    const root = element('<p>Fotossintese</p>')
    expect(findReadMatches(root, 'fotossintese')).toHaveLength(1)
    expect(findReadMatches(root, 'FOTOSSINTESE')).toHaveLength(1)
  })

  it('encontra multiplas ocorrencias na mesma nota', () => {
    const root = element('<p>luz e agua</p><p>a luz ativa a fase clara</p>')
    const matches = findReadMatches(root, 'luz')
    expect(matches).toHaveLength(2)
  })

  it('atravessa a fronteira entre paragrafos (query com espaco)', () => {
    const root = element('<p>fase</p><p>clara</p>')
    const matches = findReadMatches(root, 'fase clara')
    expect(matches).toHaveLength(1)
    // Inicia no primeiro paragrafo e termina no segundo (nos diferentes).
    expect(matches[0]!.node.parentElement?.tagName).toBe('P')
    expect(matches[0]!.endNode.parentElement?.tagName).toBe('P')
  })

  it('atravessa formatacao inline (negrito dentro da palavra)', () => {
    const root = element('<p>energia <strong>luminosa</strong></p>')
    const matches = findReadMatches(root, 'energia luminosa')
    expect(matches).toHaveLength(1)
  })

  it('nao encontra nada para query vazia ou ausente', () => {
    const root = element('<p>texto qualquer</p>')
    expect(findReadMatches(root, '')).toHaveLength(0)
    expect(findReadMatches(root, '   ')).toHaveLength(0)
    expect(findReadMatches(root, 'nao existe')).toHaveLength(0)
  })

  it('encontra dentro de celulas de tabela', () => {
    const root = element('<table><thead><tr><th>Etapa</th></tr></thead><tbody><tr><td>Fase Clara</td></tr></tbody></table>')
    const matches = findReadMatches(root, 'fase clara')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('funciona dentro da matematica KaTeX renderizada', () => {
    const root = element('<p><span class="katex"><span>x</span><span>+</span><span>y</span></span></p>')
    expect(findReadMatches(root, 'x+y')).toHaveLength(1)
  })
})
