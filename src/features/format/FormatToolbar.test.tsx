import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FormatToolbar } from './FormatToolbar'

afterEach(() => {
  cleanup()
})

function renderToolbar(overrides: Partial<Parameters<typeof FormatToolbar>[0]> = {}) {
  const props = {
    popover: { flip: false, shiftX: 0, x: 120, y: 40 },
    popoverRef: { current: null },
    submenu: null,
    setSubmenu: vi.fn(),
    onOpenSubmenu: vi.fn(),
    onScheduleCloseSubmenu: vi.fn(),
    onApplyFormat: vi.fn(),
    onOpenPostit: vi.fn(),
    onAddToDictionary: vi.fn(),
    ...overrides,
  }
  render(<FormatToolbar {...props} />)
  return props
}

describe('FormatToolbar', () => {
  it('oferece a acao de adicionar a selecao ao dicionario', async () => {
    const user = userEvent.setup()
    const props = renderToolbar()

    await user.click(
      screen.getByRole('button', { name: 'Adicionar seleção ao dicionário' }),
    )

    expect(props.onAddToDictionary).toHaveBeenCalledTimes(1)
    expect(props.onApplyFormat).not.toHaveBeenCalled()
  })

  it('nao renderiza sem selecao', () => {
    renderToolbar({ popover: null })
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })
})
