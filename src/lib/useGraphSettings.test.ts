import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { GRAPH_RENDER_LIMIT_DEFAULT } from './graphCulling'
import { useGraphSettings } from './useGraphSettings'

describe('useGraphSettings (extração do App)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('devolve os padrões com storage vazio', () => {
    const { result } = renderHook(() => useGraphSettings())
    expect(result.current.graphRenderLimit).toBe(GRAPH_RENDER_LIMIT_DEFAULT)
    expect(result.current.graph3dNodeSize).toBe(0.55)
    expect(result.current.graph3dNodeSpacing).toBe(8)
    expect(result.current.graph3dMinEdgeLength).toBe(2.5)
    expect(result.current.graph2dRepulsionStrength).toBe(2000)
    expect(result.current.graph2dLinkStiffness).toBe(4.0)
    expect(result.current.graph2dCenterForce).toBe(100)
  })

  it('valores corrompidos caem nos fallbacks (paridade com o App antigo)', () => {
    localStorage.setItem('mirrormind.graph2d.render-limit', '10') // abaixo do mínimo 50
    localStorage.setItem('mirrormind.graph3d.node-size', 'zero')
    localStorage.setItem('mirrormind.graph2d.link-distance', '-5')
    const { result } = renderHook(() => useGraphSettings())
    expect(result.current.graphRenderLimit).toBe(GRAPH_RENDER_LIMIT_DEFAULT)
    expect(result.current.graph3dNodeSize).toBe(0.55)
    expect(result.current.graph2dLinkDistance).toBe(30)
  })

  it('arredonda o limite de renderização como o inicializador antigo', () => {
    localStorage.setItem('mirrormind.graph2d.render-limit', '75.7')
    const { result } = renderHook(() => useGraphSettings())
    expect(result.current.graphRenderLimit).toBe(76)
  })

  it('setter persiste na mesma chave legada (compatibilidade)', () => {
    const { result } = renderHook(() => useGraphSettings())
    act(() => {
      result.current.setGraph2dCenterForce(250)
    })
    expect(localStorage.getItem('mirrormind.graph2d.center-force')).toBe('250')
    expect(result.current.graph2dCenterForce).toBe(250)
  })
})
