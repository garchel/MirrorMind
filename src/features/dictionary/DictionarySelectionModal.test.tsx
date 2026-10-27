import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictionarySelectionModal } from './DictionarySelectionModal'
import type { DictionaryConceptSuggestion } from './dictionarySuggestion'

afterEach(() => {
  cleanup()
})

const SUGESTAO: DictionaryConceptSuggestion = {
  term: 'estroma',
  concept: 'O fluido interno do cloroplasto.',
  existing: null,
  invalid: false,
}

const EXISTENTE = {
  term: 'estroma dos cloroplastos',
  concept: 'O fluido onde ocorre a fixação de carbono.',
  createdAtUnixMs: 1,
  updatedAtUnixMs: 1,
}

/** As props obrigatorias do modal, com o que cada teste muda. */
function renderModal(overrides: Partial<{
  open: boolean
  selection: string
  loading: boolean
  suggestion: DictionaryConceptSuggestion | null
  error: string
  onClose: () => void
  onRetry: () => void
  onSave: (term: string, concept: string) => Promise<void>
}> = {}) {
  const props = {
    open: true,
    selection: 'estroma dos cloroplastos',
    loading: false,
    suggestion: SUGESTAO,
    error: '',
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  const view = render(<DictionarySelectionModal {...props} />)
  return { ...props, view }
}

describe('DictionarySelectionModal', () => {
  it('mostra o termo e o conceito sugeridos, sem bloco com a nota', () => {
    renderModal()
    // O trecho longo nao vira um bloco proprio: era ele que virava painel
    // rolavel. O campo "Termo" ja mostra o que sera gravado.
    expect(screen.queryByText(/“estroma dos cloroplastos”/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Termo')).toHaveValue('estroma')
    expect(screen.getByLabelText('Conceito')).toHaveValue(
      'O fluido interno do cloroplasto.',
    )
  })

  it('grava a palavra selecionada, nao o assunto que a IA devolveu', () => {
    // O caso real: nota sobre fotossintese, selecao `glicose`, e a IA devolve
    // `Fotossintese` como verbete. O campo Termo tem de mostrar a selecao.
    renderModal({
      selection: 'glicose',
      suggestion: {
        term: 'Fotossíntese',
        concept: 'O processo em que a planta produz glicose.',
        existing: null,
        invalid: false,
      },
    })

    expect(screen.getByLabelText('Termo')).toHaveValue('glicose')
    expect(screen.getByLabelText('Conceito')).toHaveValue(
      'O processo em que a planta produz glicose.',
    )
  })

  it('avisa enquanto a IA esta lendo o contexto', () => {
    renderModal({ loading: true, suggestion: null })
    expect(screen.getByRole('status')).toHaveTextContent(/Lendo o contexto/)
    expect(screen.getByRole('button', { name: /Adicionar ao dicionário/ })).toBeDisabled()
  })

  it('grava o termo e o conceito revisados e fecha', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderModal()

    const conceito = screen.getByLabelText('Conceito')
    await user.clear(conceito)
    await user.type(conceito, 'A fase líquida do cloroplasto.')
    await user.click(screen.getByRole('button', { name: /Adicionar ao dicionário/ }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('estroma', 'A fase líquida do cloroplasto.'),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('nao grava sem termo ou sem conceito', async () => {
    const user = userEvent.setup()
    const { onSave } = renderModal()

    await user.clear(screen.getByLabelText('Conceito'))
    const botao = screen.getByRole('button', { name: /Adicionar ao dicionário/ })
    expect(botao).toBeDisabled()
    await user.click(botao)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('avisa quando o termo ja existe e oferece atualizar o conceito', async () => {
    const user = userEvent.setup()
    renderModal({
      selection: 'estroma',
      suggestion: { ...SUGESTAO, existing: EXISTENTE },
    })

    expect(screen.getByText(/já está no dicionário deste Vault/)).toBeInTheDocument()
    expect(screen.getByText(EXISTENTE.concept)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Atualizar conceito/ }),
    ).toBeInTheDocument()

    // Trocar o termo a mao torna o aviso uma afirmacao sobre outro verbete.
    const termo = screen.getByLabelText('Termo')
    await user.clear(termo)
    await user.type(termo, 'cloroplasto')
    expect(screen.queryByText(/já está no dicionário deste Vault/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Adicionar ao dicionário/ }),
    ).toBeInTheDocument()
  })

  it('deixa o usuario escrever o conceito quando a IA nao respondeu no formato', async () => {
    const user = userEvent.setup()
    const { onSave, onRetry } = renderModal({
      suggestion: { term: 'estroma', concept: '', existing: null, invalid: true },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/não respondeu no formato/)
    expect(screen.getByLabelText('Termo')).toHaveValue('estroma')
    expect(screen.getByLabelText('Conceito')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(onRetry).toHaveBeenCalled()

    await user.type(screen.getByLabelText('Conceito'), 'O fluido interno.')
    await user.click(screen.getByRole('button', { name: /Adicionar ao dicionário/ }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('estroma', 'O fluido interno.'),
    )
  })

  it('mostra a falha real do provider e permite tentar de novo', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderModal({
      loading: false,
      suggestion: null,
      error: 'O Ollama local nao esta acessivel.',
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/Ollama local/)
    await user.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('mostra no formulario o erro de gravar, sem fechar', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSave = vi.fn().mockRejectedValue(new Error('O termo nao pode ser vazio.'))
    renderModal({ onClose, onSave })

    await user.click(screen.getByRole('button', { name: /Adicionar ao dicionário/ }))

    expect(await screen.findByText('O termo nao pode ser vazio.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
