import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictionarySearchToast } from './DictionarySearchToast'

afterEach(() => {
  cleanup()
})

/** As props obrigatorias do aviso, com o que cada teste muda. */
function renderToast(overrides: Partial<{
  term: string
  status: 'searching' | 'ready' | 'error'
  error: string
  onOpen: () => void
  onDismiss: () => void
}> = {}) {
  const props = {
    term: 'estroma',
    status: 'searching' as const,
    error: '',
    onOpen: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  }
  render(<DictionarySearchToast {...props} />)
  return props
}

describe('DictionarySearchToast', () => {
  it('durante a busca avisa que o pedido esta em andamento e nao oferece Abrir', () => {
    renderToast()

    expect(screen.getByRole('status')).toHaveTextContent('Buscando a definição de “estroma”')
    // O botao so aparece quando existe resultado: abrir o modal antes disso
    // levaria o usuario de volta para a espera bloqueante.
    expect(screen.queryByRole('button', { name: 'Abrir' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dispensar aviso' })).toBeInTheDocument()
  })

  it('quando a definicao fica pronta oferece Abrir e chama o App', async () => {
    const user = userEvent.setup()
    const props = renderToast({ status: 'ready' })

    expect(screen.getByRole('status')).toHaveTextContent('está pronta')
    await user.click(screen.getByRole('button', { name: 'Abrir' }))

    expect(props.onOpen).toHaveBeenCalledTimes(1)
  })

  it('na falha mostra o motivo e ainda deixa abrir para tentar de novo', async () => {
    const user = userEvent.setup()
    const props = renderToast({
      status: 'error',
      error: 'O provedor de IA não respondeu.',
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível buscar a definição de “estroma”')
    expect(alert).toHaveTextContent('O provedor de IA não respondeu.')

    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(props.onOpen).toHaveBeenCalledTimes(1)
  })

  it('dispensar fecha o aviso sem abrir o modal', async () => {
    const user = userEvent.setup()
    const props = renderToast({ status: 'ready' })

    await user.click(screen.getByRole('button', { name: 'Dispensar aviso' }))

    expect(props.onDismiss).toHaveBeenCalledTimes(1)
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('nao mostra contador de segundos: o giro do icone ja diz que a busca vive', () => {
    vi.useFakeTimers()
    try {
      renderToast()
      vi.advanceTimersByTime(12_000)

      const toast = screen.getByRole('status')
      expect(toast.querySelector('.dictionary-search-toast-elapsed')).toBeNull()
      expect(toast).not.toHaveTextContent(/\d+\s*s/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('encurta um trecho longo para o aviso nao virar um painel', () => {
    const longSelection = 'A fixação de carbono acontece no estroma do cloroplasto e depende da luz'
    renderToast({ term: longSelection })

    const title = screen.getByRole('status').querySelector('.dictionary-search-toast-title')
    expect(title?.textContent).toContain('…')
    expect(title?.textContent).not.toContain('depende da luz')
  })
})
