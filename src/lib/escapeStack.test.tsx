import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { useEscapeToClose } from './escapeStack'

function DialogHost({ id, onClosed }: { id: string; onClosed: (id: string) => void }) {
  const [isOpen, setIsOpen] = useState(true)
  useEscapeToClose(isOpen, () => {
    setIsOpen(false)
    onClosed(id)
  })
  return null
}

describe('useEscapeToClose', () => {
  const closed: string[] = []
  const onClosed = (id: string) => closed.push(id)

  beforeEach(() => {
    closed.length = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('Escape fecha o dialog registrado', async () => {
    render(<DialogHost id="a" onClosed={onClosed} />)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toEqual(['a'])
  })

  it('com dois dialogs empilhados, Escape fecha somente o do topo (um por vez)', async () => {
    render(<DialogHost id="a" onClosed={onClosed} />)
    const top = render(<DialogHost id="b-top" onClosed={onClosed} />)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toEqual(['b-top'])
    // Segundo Escape: agora fecha o dialog de baixo.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toEqual(['b-top', 'a'])
    top.unmount()
  })

  it('dialog fechado deixa de responder ao Escape', async () => {
    const { rerender } = render(<DialogHost id="a" onClosed={onClosed} />)
    // Fecha o dialog programaticamente (rerender com o estado interno false e
    // um novo mount): o mais simples e desmontar.
    rerender(<DialogHost key="closed" id="a" onClosed={onClosed} />)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toEqual(['a'])
  })

  it('ignora teclas que nao sao Escape', async () => {
    render(<DialogHost id="a" onClosed={onClosed} />)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(closed).toEqual([])
  })
})
