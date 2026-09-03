import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Modal } from './Modal'

describe('<Modal> bloqueante (dismissable={false})', () => {
  it('ignora Escape quando bloqueante', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <Modal open dismissable={false} onClose={onClose} label="Bloqueante">
        <button type="button">Ação</button>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    unmount()
  })

  it('ignora clique no backdrop quando bloqueante', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <Modal open dismissable={false} onClose={onClose} label="Bloqueante">
        <button type="button">Ação</button>
      </Modal>,
    )
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Bloqueante' }))
    expect(onClose).not.toHaveBeenCalled()
    unmount()
  })

  it('Escape dispensa por padrão (dismissable omitido)', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <Modal open onClose={onClose} label="Normal">
        <button type="button">Ação</button>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })
})
