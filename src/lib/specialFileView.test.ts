import { describe, expect, it } from 'vitest'
import { summarizeCanvas, summarizeExcalidraw } from './specialFileView'

describe('summarizeCanvas', () => {
  it('conta nos por tipo e lista nos de texto com rotulo', () => {
    const summary = summarizeCanvas(JSON.stringify({
      nodes: [
        { id: 'a', type: 'text', text: 'Primeiro no' },
        { id: 'b', type: 'file', label: 'nota.md' },
        { id: 'c', type: 'group' },
      ],
      edges: [{ id: 'e1' }],
    }))
    expect(summary.kind).toBe('canvas')
    expect(summary.itemCount).toBe(3)
    // Contagens iguais desempatam em ordem alfabetica.
    expect(summary.types).toEqual([
      { type: 'edges', count: 1 },
      { type: 'file', count: 1 },
      { type: 'group', count: 1 },
      { type: 'text', count: 1 },
    ])
    expect(summary.canvasNodes).toEqual([
      { id: 'a', type: 'text', text: 'Primeiro no' },
      { id: 'b', type: 'file', text: 'nota.md' },
    ])
    expect(summary.raw).toBe(null)
  })

  it('cai para a fonte crua quando o JSON e invalido', () => {
    const summary = summarizeCanvas('{ invalido')
    expect(summary.raw).toBe('{ invalido')
    expect(summary.itemCount).toBe(0)
  })
})

describe('summarizeExcalidraw', () => {
  it('conta elementos por tipo', () => {
    const summary = summarizeExcalidraw(JSON.stringify({
      type: 'excalidraw',
      elements: [{ type: 'text' }, { type: 'rectangle' }, { type: 'text' }],
    }))
    expect(summary.kind).toBe('excalidraw')
    expect(summary.itemCount).toBe(3)
    expect(summary.types).toEqual([
      { type: 'text', count: 2 },
      { type: 'rectangle', count: 1 },
    ])
  })

  it('cai para a fonte crua quando o JSON e invalido', () => {
    const summary = summarizeExcalidraw('{ quebrado')
    expect(summary.raw).toBe('{ quebrado')
  })
})
