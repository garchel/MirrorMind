import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

const EXPANSAO = {
  sourceQuote: 'Carbono Fix (rubisco) = CO2 + ribulose',
  expanded:
    'A fixacao de carbono usa a enzima rubisco, que adiciona CO2 a uma molecula de ribulose-1,5-bisfosfato.',
  startUtf16: 20,
  endUtf16: 54,
}

const DEFINICAO = {
  term: 'estroma',
  definition: 'O fluido interno do cloroplasto.',
  sourceQuote: 'A fixacao de carbono ocorre no estroma dos cloroplastos.',
  startUtf16: 40,
  confidence: 0.8,
}

function renderPanel(overrides: Partial<Parameters<typeof NoteImprovementPanel>[0]> = {}) {
  return render(
    <NoteImprovementPanel
      vaultPath={'C:\\Vault'}
      relativePath="nota.md"
      provider="ollama"
      before={NOTA}
      onApply={() => true}
      onApplyExpansion={() => true}
      onSaveToDictionary={async () => true}
      onBack={() => {}}
      {...overrides}
    />,
  )
}

describe('NoteImprovementPanel', () => {
  it('pede as sugestões ao apertar o botão', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue({
      expansions: [],
      suggestions: [DEFINICAO],
      rejected: 2,
      invalid: false,
    })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))

    await waitFor(() => expect(proposeMock).toHaveBeenCalled())
    expect(await screen.findByText('estroma')).toBeInTheDocument()
    expect(screen.getByText('O fluido interno do cloroplasto.')).toBeInTheDocument()
  })

  it('mostra a expansao do trecho apressado, antes e depois', async () => {
    // O exemplo do usuario: a anotacao de video aula ao lado da frase que
    // ele quis dizer. Sem o "antes", o usuario nao ve o que esta expandindo.
    const user = userEvent.setup()
    proposeMock.mockResolvedValue({
      expansions: [EXPANSAO],
      suggestions: [],
      rejected: 0,
      invalid: false,
    })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))

    expect(
      await screen.findByRole('heading', {
        name: /trechos que você escreveu apressado/i,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Carbono Fix (rubisco) = CO2 + ribulose')).toBeInTheDocument()
    expect(screen.getByText(EXPANSAO.expanded)).toBeInTheDocument()
  })

  it('aplica a expansao ao rascunho', async () => {
    const user = userEvent.setup()
    const onApplyExpansion = vi.fn().mockReturnValue(true)
    proposeMock.mockResolvedValue({
      expansions: [EXPANSAO],
      suggestions: [],
      rejected: 0,
      invalid: false,
    })
    renderPanel({ onApplyExpansion })

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))
    await user.click(await screen.findByRole('button', { name: /Aplicar ao rascunho/ }))

    expect(onApplyExpansion).toHaveBeenCalledWith(
      expect.objectContaining({ expanded: EXPANSAO.expanded }),
    )
    expect(
      await screen.findByRole('button', { name: /Aplicada ao rascunho/ }),
    ).toBeDisabled()
  })

  it('avisa quando a expansao ja foi aplicada', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue({
      expansions: [EXPANSAO],
      suggestions: [],
      rejected: 0,
      invalid: false,
    })
    renderPanel({ onApplyExpansion: () => false })

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))
    await user.click(await screen.findByRole('button', { name: /Aplicar ao rascunho/ }))

    // Devolveu `false` (edicao invalida): o botao **nao** fica marcado como
    // aplicado, porque nada foi gravado.
    expect(
      await screen.findByRole('button', { name: /Aplicar ao rascunho/ }),
    ).toBeEnabled()
  })

  it('avisa quando nao falta nada', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue({
      expansions: [],
      suggestions: [],
      rejected: 3,
      invalid: false,
    })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))

    expect(await screen.findByText(/Nada a melhorar nesta nota/)).toBeInTheDocument()
    // O numero de descartes e diagnostico: diz que o filtro trabalha.
    expect(screen.getByText(/3 sugestão\(ões\) foram descartadas/)).toBeInTheDocument()
  })

  it('avisa quando a IA nao respondeu no formato', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue({
      expansions: [],
      suggestions: [],
      rejected: 0,
      invalid: true,
    })
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

  it('mostra o erro que veio do pai', () => {
    // O pai e quem sabe que a edicao ficou desatualizada (a nota mudou
    // desde a sugestao). O painel mostra o erro dele junto do seu.
    renderPanel({ externalError: 'a nota mudou desde a sugestão' })
    expect(screen.getByRole('alert')).toHaveTextContent(/a nota mudou/)
  })

  it('aplica a primeira sugestao ao rascunho', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn().mockReturnValue(true)
    proposeMock.mockResolvedValue({
      expansions: [],
      suggestions: [DEFINICAO],
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

  it('abre o dicionario e grava o conceito', async () => {
    // E o que fecha o ciclo: a definicao que faltava vira verbete, e passa a
    // aparecer no hover de qualquer nota do Vault.
    const user = userEvent.setup()
    const onSaveToDictionary = vi.fn().mockResolvedValue(true)
    proposeMock.mockResolvedValue({
      expansions: [],
      suggestions: [DEFINICAO],
      rejected: 0,
      invalid: false,
    })
    renderPanel({ onSaveToDictionary })

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))
    await user.click(await screen.findByRole('button', { name: /Adicionar ao dicionário/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/Adicionar conceitos ao dicionário/)

    await user.click(
      within(dialog).getByRole('button', { name: /Adicionar ao dicionário/ }),
    )

    await waitFor(() =>
      expect(onSaveToDictionary).toHaveBeenCalledWith(
        'estroma',
        'O fluido interno do cloroplasto.',
      ),
    )
  })

  it('permite editar a definicao antes de gravar', async () => {
    // O conceito depende do assunto: o que o aluno aceita vale mais do que o
    // provider_propôs.
    const user = userEvent.setup()
    const onSaveToDictionary = vi.fn().mockResolvedValue(true)
    proposeMock.mockResolvedValue({
      expansions: [],
      suggestions: [DEFINICAO],
      rejected: 0,
      invalid: false,
    })
    renderPanel({ onSaveToDictionary })

    await user.click(screen.getByRole('button', { name: /Sugerir melhorias/ }))
    await user.click(await screen.findByRole('button', { name: /Adicionar ao dicionário/ }))

    const dialog = await screen.findByRole('dialog')
    const campo = within(dialog).getByRole('textbox')
    await user.clear(campo)
    await user.type(campo, 'A fase liquida do cloroplasto.')
    await user.click(
      within(dialog).getByRole('button', { name: /Adicionar ao dicionário/ }),
    )

    await waitFor(() =>
      expect(onSaveToDictionary).toHaveBeenCalledWith(
        'estroma',
        'A fase liquida do cloroplasto.',
      ),
    )
  })

  it('a sugestao vai para o rascunho, e o usuario revisa', () => {
    // O texto da propria interface diz isso: a feature nao altera a nota
    // sozinha.
    renderPanel()
    expect(screen.getByText(/revisa antes de salvar/i)).toBeInTheDocument()
  })
})
