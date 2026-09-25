import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteStructureReport } from './NoteStructureReport'
import type { StructuralAudit } from './ai'

const audit: StructuralAudit = {
  noteWords: 40,
  unitCount: 2,
  findings: [
    {
      code: 'orphanPreamble',
      severity: 'warning',
      message: 'Os parágrafos antes do primeiro título formam um preâmbulo sem rótulo.',
      suggestion: 'Dê um título ao preâmbulo.',
      sourceQuote: 'Texto inicial.',
      sourceStartUtf16: 59,
      sourceEndUtf16: 74,
      edit: {
        kind: 'insertHeadingBefore',
        startUtf16: 59,
        endUtf16: null,
        insert: '## Introducao\n\n',
        ops: null,
      },
    },
    {
      code: 'longSection',
      severity: 'info',
      message: 'Seção longa demais.',
      suggestion: 'Divida a seção.',
      sourceQuote: null,
      sourceStartUtf16: null,
      sourceEndUtf16: null,
      edit: null,
    },
  ],
}

function renderReport(overrides: Partial<React.ComponentProps<typeof NoteStructureReport>> = {}) {
  const onBack = vi.fn()
  const onRetry = vi.fn()
  const onApply = vi.fn()
  render(
    <NoteStructureReport
      audit={audit}
      loading={false}
      error={null}
      appliedIndex={null}
      onBack={onBack}
      onRetry={onRetry}
      onApply={onApply}
      {...overrides}
    />,
  )
  return { onApply, onBack, onRetry }
}

afterEach(cleanup)

describe('NoteStructureReport (página de estrutura)', () => {
  it('espelha o relatório: voltar, título com contagem e achados numerados', () => {
    const { onBack } = renderReport()
    expect(screen.getByText('Estrutura da nota')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2 pontos de atenção' })).toBeInTheDocument()
    expect(screen.getByText(/40 palavras/)).toBeInTheDocument()
    expect(screen.getByText(/2 unidades de revisão/)).toBeInTheDocument()
    expect(screen.getByText('Os parágrafos antes do primeiro título formam um preâmbulo sem rótulo.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao menu de avaliação' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('aplica um achado por vez e oferece re-execução', async () => {
    const user = userEvent.setup()
    const { onApply } = renderReport()
    const applyButtons = screen.getAllByRole('button', { name: 'Aplicar no rascunho' })
    // Só o achado com edição determinística tem botão.
    expect(applyButtons).toHaveLength(1)
    await user.click(applyButtons[0])
    expect(onApply).toHaveBeenCalledWith(0)
  })

  it('celebra estrutura limpa sem lista de achados', () => {
    renderReport({ audit: { ...audit, findings: [] } })
    expect(screen.getByRole('heading', { name: 'Estrutura pronta para revisão' })).toBeInTheDocument()
    expect(screen.getByText('Estrutura pronta')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aplicar no rascunho' })).not.toBeInTheDocument()
  })

  it('mostra erro com nova tentativa', async () => {
    const user = userEvent.setup()
    const { onRetry } = renderReport({ audit: null, error: 'Falha na auditoria' })
    expect(screen.getByRole('heading', { name: 'Não foi possível analisar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('fecha com Escape', () => {
    const { onBack } = renderReport()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
