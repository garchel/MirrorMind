import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteImprovementPanel } from './NoteImprovementPanel'

const proposeMock = vi.hoisted(() => vi.fn())

vi.mock('./calibrationComparison', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('./calibrationComparison')
  >()
  return { ...original, proposeNoteImprovements: proposeMock }
})

afterEach(() => {
  cleanup()
  proposeMock.mockReset()
})

const NOTA = `# Ciclo de Calvin

A fixacao de carbono ocorre no estroma dos cloroplastos.`

function renderPanel(overrides: Partial<Parameters<typeof NoteImprovementPanel>[0]> = {}) {
  return render(
    <NoteImprovementPanel
      vaultPath={'C:\\Vault'}
      relativePath="nota.md"
      provider="ollama"
      before={NOTA}
      onApply={() => true}
      onBack={() => {}}
      {...overrides}
    />,
  )
}

describe('NoteImprovementPanel', () => {
  it('pede as sugestões ao apertar o botão', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue({
      suggestions: [
        {
          term: 'estroma',
          definition: 'O fluido interno do cloroplasto.',
          sourceQuote: 'A fixacao de carbono ocorre no estroma dos cloroplastos.',
          startUtf16: 40,
          confidence: 0.8,
        },
      ],
      rejected: 2,
      invalid: false,
    })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))

    await waitFor(() => expect(proposeMock).toHaveBeenCalled())
    expect(await screen.findByText('estroma')).toBeInTheDocument()
    expect(screen.getByText('O fluido interno do cloroplasto.')).toBeInTheDocument()
  })

  it('avisa quando nao falta nenhuma definicao', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue({
      suggestions: [],
      rejected: 3,
      invalid: false,
    })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))

    expect(await screen.findByText(/Nenhuma definição faltando/)).toBeInTheDocument()
    // O numero de descartes e diagnostico: diz que o filtro trabalha.
    expect(screen.getByText(/3 sugestão\(ões\) foram descartadas/)).toBeInTheDocument()
  })

  it('avisa quando a IA nao respondeu no formato', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue({ suggestions: [], rejected: 0, invalid: true })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))

    expect(await screen.findByText(/não respondeu no formato/)).toBeInTheDocument()
  })

  it('mostra o erro quando a chamada falha', async () => {
    const user = userEvent.setup()
    proposeMock.mockRejectedValue(new Error('a chave foi recusada'))
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/a chave foi recusada/)
  })

  it('aplica a primeira sugestao ao rascunho', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn().mockReturnValue(true)
    proposeMock.mockResolvedValue({
      suggestions: [
        {
          term: 'estroma',
          definition: 'O fluido interno do cloroplasto.',
          sourceQuote: 'A fixacao de carbono ocorre no estroma dos cloroplastos.',
          startUtf16: 40,
          confidence: 0.8,
        },
      ],
      rejected: 0,
      invalid: false,
    })
    renderPanel({ onApply })

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))
    await user.click(await screen.findByRole('button', { name: /Aplicar a primeira/ }))

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'estroma' }),
    )
    expect(await screen.findByRole('button', { name: /Aplicada ao rascunho/ })).toBeDisabled()
  })

  it('a sugestao vai para o rascunho, e o usuario revisa', () => {
    // O texto da propria interface diz isso: a feature nao altera a nota
    // sozinha.
    renderPanel()
    expect(screen.getByText(/revisa antes de salvar/i)).toBeInTheDocument()
  })
})
