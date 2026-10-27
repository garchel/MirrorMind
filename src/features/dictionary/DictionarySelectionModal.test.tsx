import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
  context: 'Na nota, a fixação de carbono acontece no estroma.',
  existing: null,
  invalid: false,
}

const SUGESTAO_SEM_CONTEXTO: DictionaryConceptSuggestion = {
  ...SUGESTAO,
  context: '',
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
  it('mostra o termo selecionado e o conceito, sem bloco com o trecho', () => {
    renderModal()
    // O trecho longo nao vira um bloco proprio: era ele que virava painel
    // rolavel. O campo "Termo" ja mostra o que sera gravado.
    expect(screen.queryByText(/“estroma dos cloroplastos”/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Termo')).toHaveValue('estroma dos cloroplastos')
    expect(screen.getByLabelText('Conceito')).toHaveValue(
      'O fluido interno do cloroplasto.',
    )
    expect(screen.getByText('Nesta nota')).toBeInTheDocument()
  })

  it('grava so a definicao: o papel do termo na nota fica na tela', async () => {
    // O caso do `eletrons`: a primeira resposta descrevia o papel do eletron na
    // fotossintese. Isso e util para conferir, mas o verbete tem de ser a
    // definicao do termo.
    const user = userEvent.setup()
    const { onSave } = renderModal({
      selection: 'elétrons',
      suggestion: {
        term: 'elétrons',
        concept: 'Partículas subatômicas com carga elétrica negativa.',
        context: 'Na fotólise da água, os elétrons liberados seguem para a cadeia transportadora.',
        existing: null,
        invalid: false,
      },
    })

    expect(screen.getByText('Nesta nota')).toBeInTheDocument()
    expect(
      screen.getByText(/seguem para a cadeia transportadora/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Não é salvo no dicionário/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Adicionar ao dicionário/ }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'elétrons',
        'Partículas subatômicas com carga elétrica negativa.',
      ),
    )
  })

  it('nao mostra a secao "Nesta nota" quando a IA nao devolveu contexto', () => {
    renderModal({ suggestion: SUGESTAO_SEM_CONTEXTO })
    expect(screen.queryByText('Nesta nota')).not.toBeInTheDocument()
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
        context: '',
        existing: null,
        invalid: false,
      },
    })

    expect(screen.getByLabelText('Termo')).toHaveValue('glicose')
    expect(screen.getByLabelText('Conceito')).toHaveValue(
      'O processo em que a planta produz glicose.',
    )
  })

  it('nao troca o trecho de duas palavras pelo termo que a IA devolveu', () => {
    // O relato: na nota sobre fotossintese, selecionou "fase clara" e o campo
    // Termo apareceu como "Fase Escura", a secao vizinha da nota.
    renderModal({
      selection: 'fase clara',
      suggestion: {
        term: 'Fase Escura',
        concept: 'A etapa em que nao ha luz.',
        context: '',
        existing: null,
        invalid: false,
      },
    })

    expect(screen.getByLabelText('Termo')).toHaveValue('fase clara')
  })

  it('avisa, com spinner e esqueleto, enquanto a IA prepara o conceito', () => {
    renderModal({ loading: true, suggestion: null })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/Preparando o conceito/)
    expect(status).toHaveTextContent(/ajustar o termo enquanto espera/)
    // A selecao aparece de imediato e pode ser editada: o termo nao depende
    // da resposta da IA.
    expect(screen.getByLabelText('Termo')).toHaveValue('estroma dos cloroplastos')
    expect(screen.getByLabelText('Termo')).toBeEnabled()
    expect(screen.getByLabelText('Conceito')).toBeDisabled()
    expect(document.querySelector('.dictionary-selection-skeleton')).not.toBeNull()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: /Adicionar ao dicionário/ })).toBeDisabled()
  })

  it('conta os segundos para o usuario saber que o pedido esta vivo', () => {
    vi.useFakeTimers()
    try {
      renderModal({ loading: true, suggestion: null })
      // Nos primeiros segundos o contador nao aparece: so quando a espera
      // passa do que parece instantaneo.
      expect(screen.queryByText(/\d+ s/)).not.toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(screen.getByText('5 s')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserva o termo editado quando a sugestao chega', async () => {
    const user = userEvent.setup()
    const { view } = renderModal({ loading: true, suggestion: null })

    const termo = screen.getByLabelText('Termo')
    await user.clear(termo)
    await user.type(termo, 'fase clara (fotossíntese)')

    view.rerender(
      <DictionarySelectionModal
        open
        selection="estroma dos cloroplastos"
        loading={false}
        suggestion={SUGESTAO}
        error=""
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Termo')).toHaveValue('fase clara (fotossíntese)')
    expect(screen.getByLabelText('Conceito')).toHaveValue(
      'O fluido interno do cloroplasto.',
    )
  })

  it('grava o termo e o conceito revisados e fecha', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderModal()

    const conceito = screen.getByLabelText('Conceito')
    await user.clear(conceito)
    await user.type(conceito, 'A fase líquida do cloroplasto.')
    await user.click(screen.getByRole('button', { name: /Adicionar ao dicionário/ }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'estroma dos cloroplastos',
        'A fase líquida do cloroplasto.',
      ),
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
      suggestion: { term: 'estroma', concept: '', context: '', existing: null, invalid: true },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/não respondeu no formato/)
    expect(screen.getByLabelText('Termo')).toHaveValue('estroma dos cloroplastos')
    expect(screen.getByLabelText('Conceito')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(onRetry).toHaveBeenCalled()

    await user.type(screen.getByLabelText('Conceito'), 'O fluido interno.')
    await user.click(screen.getByRole('button', { name: /Adicionar ao dicionário/ }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'estroma dos cloroplastos',
        'O fluido interno.',
      ),
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
