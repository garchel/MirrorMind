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

/** O relatorio vazio de cada escopo, com os campos que a tela le. */
function report(overrides: {
  expansions?: unknown[]
  suggestions?: unknown[]
  rejected?: number
  alreadyKnown?: string[]
  invalid?: boolean
}) {
  return {
    expansions: overrides.expansions ?? [],
    suggestions: overrides.suggestions ?? [],
    rejected: overrides.rejected ?? 0,
    alreadyKnown: overrides.alreadyKnown ?? [],
    invalid: overrides.invalid ?? false,
  }
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

const COMPLETAR = /Completar nota/
const DEFINICOES = /Sugerir definições/

describe('NoteImprovementPanel', () => {
  it('as duas tarefas sao dois botoes independentes', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue(report({}))
    renderPanel()

    // Um botao por tarefa: expandir a nota e buscar definicoes sao pedidos
    // diferentes, e cada um cabe numa chamada propria.
    const completar = screen.getByRole('button', { name: COMPLETAR })
    const definicoes = screen.getByRole('button', { name: DEFINICOES })
    expect(completar).toBeEnabled()
    expect(definicoes).toBeEnabled()

    await user.click(completar)
    expect(proposeMock).toHaveBeenCalledWith(
      'C:\\Vault',
      'nota.md',
      'ollama',
      'expansions',
    )

    await user.click(definicoes)
    expect(proposeMock).toHaveBeenLastCalledWith(
      'C:\\Vault',
      'nota.md',
      'ollama',
      'definitions',
    )
  })

  it('pede as definições ao apertar o botão de definições', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue(report({ suggestions: [DEFINICAO], rejected: 2 }))
    renderPanel()

    await user.click(screen.getByRole('button', { name: DEFINICOES }))

    await waitFor(() => expect(proposeMock).toHaveBeenCalled())
    expect(await screen.findByText('estroma')).toBeInTheDocument()
    expect(screen.getByText('O fluido interno do cloroplasto.')).toBeInTheDocument()
  })

  it('mostra a expansao do trecho apressado, antes e depois', async () => {
    // O exemplo do usuario: a anotacao de video aula ao lado da frase que
    // ele quis dizer. Sem o "antes", o usuario nao ve o que esta expandindo.
    const user = userEvent.setup()
    proposeMock.mockResolvedValue(report({ expansions: [EXPANSAO] }))
    renderPanel()

    await user.click(screen.getByRole('button', { name: COMPLETAR }))

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
    proposeMock.mockResolvedValue(report({ expansions: [EXPANSAO] }))
    renderPanel({ onApplyExpansion })

    await user.click(screen.getByRole('button', { name: COMPLETAR }))
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
    proposeMock.mockResolvedValue(report({ expansions: [EXPANSAO] }))
    renderPanel({ onApplyExpansion: () => false })

    await user.click(screen.getByRole('button', { name: COMPLETAR }))
    await user.click(await screen.findByRole('button', { name: /Aplicar ao rascunho/ }))

    // Devolveu `false` (edicao invalida): o botao **nao** fica marcado como
    // aplicado, porque nada foi gravado.
    expect(
      await screen.findByRole('button', { name: /Aplicar ao rascunho/ }),
    ).toBeEnabled()
  })

  it('avisa quando a nota nao tem trecho apressado', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue(report({}))
    renderPanel()

    await user.click(screen.getByRole('button', { name: COMPLETAR }))

    expect(
      await screen.findByText(/Nenhum trecho abreviado encontrado/),
    ).toBeInTheDocument()
  })

  it('avisa quando nao falta termo para o dicionario', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue(report({ rejected: 3 }))
    renderPanel()

    await user.click(screen.getByRole('button', { name: DEFINICOES }))

    expect(await screen.findByText(/Nada a acrescentar ao dicionário/)).toBeInTheDocument()
    // O numero de descartes e diagnostico: diz que o filtro trabalha.
    expect(screen.getByText(/3 sugestão\(ões\) foram descartadas/)).toBeInTheDocument()
  })

  it('diz quantos termos a nota usa ja estao no dicionario', async () => {
    // `alreadyKnown` nao e recusa: e proposta desnecessaria. A tela separa as
    // duas coisas, porque "o dicionario ja cobria" nao e "a sugestao era ruim".
    const user = userEvent.setup()
    proposeMock.mockResolvedValue(
      report({ alreadyKnown: ['estroma', 'rubisco'], rejected: 0 }),
    )
    renderPanel()

    await user.click(screen.getByRole('button', { name: DEFINICOES }))

    expect(
      await screen.findByText(/2 termo\(s\) que a nota usa já estão no seu dicionário/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/foram descartadas/)).toBeNull()
  })

  it('uma busca de definicoes nao apaga a expansao ja mostrada', async () => {
    // Os dois relatorios vivem em estados separados: e o que permite rodar as
    // duas tarefas sem perder o resultado da primeira.
    const user = userEvent.setup()
    proposeMock
      .mockResolvedValueOnce(report({ expansions: [EXPANSAO] }))
      .mockResolvedValueOnce(report({ suggestions: [DEFINICAO] }))
    renderPanel()

    await user.click(screen.getByRole('button', { name: COMPLETAR }))
    expect(await screen.findByText(EXPANSAO.expanded)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: DEFINICOES }))
    expect(await screen.findByText('estroma')).toBeInTheDocument()
    expect(screen.getByText(EXPANSAO.expanded)).toBeInTheDocument()
  })

  it('avisa quando a IA nao respondeu no formato', async () => {
    const user = userEvent.setup()
    proposeMock.mockResolvedValue(report({ invalid: true }))
    renderPanel()

    await user.click(screen.getByRole('button', { name: DEFINICOES }))

    expect(await screen.findByText(/não respondeu no formato/)).toBeInTheDocument()
  })

  it('mostra o erro quando a chamada falha', async () => {
    const user = userEvent.setup()
    proposeMock.mockRejectedValue(new Error('a chave foi recusada'))
    renderPanel()

    await user.click(screen.getByRole('button', { name: COMPLETAR }))

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
    proposeMock.mockResolvedValue(report({ suggestions: [DEFINICAO] }))
    renderPanel({ onApply })

    await user.click(screen.getByRole('button', { name: DEFINICOES }))
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
    proposeMock.mockResolvedValue(report({ suggestions: [DEFINICAO] }))
    renderPanel({ onSaveToDictionary })

    await user.click(screen.getByRole('button', { name: DEFINICOES }))
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
    // provider propôs.
    const user = userEvent.setup()
    const onSaveToDictionary = vi.fn().mockResolvedValue(true)
    proposeMock.mockResolvedValue(report({ suggestions: [DEFINICAO] }))
    renderPanel({ onSaveToDictionary })

    await user.click(screen.getByRole('button', { name: DEFINICOES }))
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
