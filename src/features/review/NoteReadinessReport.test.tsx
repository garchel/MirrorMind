import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NoteReadinessReport } from './NoteReadinessReport'
import type { ReadinessAttempt, ReadinessReport } from './ai'

afterEach(() => {
  cleanup()
})

function report(overrides: Partial<ReadinessReport> = {}): ReadinessReport {
  return {
    status: 'ready',
    explanation: 'A nota tem material suficiente.',
    centralIdea: null,
    evaluablePoints: [],
    issues: [],
    confidence: 0.92,
    statusProbabilities: { ready: 0.92, ambiguous: 0.06, insufficient: 0.02 },
    confidenceDegraded: false,
    ...overrides,
  }
}

function attempt(overrides: Partial<ReadinessReport> = {}): ReadinessAttempt {
  return {
    outcome: 'valid',
    sourceHash: `sha256:${'b'.repeat(64)}`,
    report: report(overrides),
  }
}

function renderReport(overrides: Partial<ReadinessReport> = {}) {
  return render(
    <NoteReadinessReport
      attempt={attempt(overrides)}
      isStaleReport={false}
      error=""
      busy={false}
      onClose={() => {}}
      onRetry={() => {}}
    />,
  )
}

describe('confiança do modelo no relatório de prontidão', () => {
  it('mostra a confiança quando o motor a informou', () => {
    renderReport({ confidence: 0.92 })

    const confidence = screen.getByTestId('review-readiness-confidence')
    expect(confidence).toBeInTheDocument()
    // A distribuição recolhida também traz "92%", então a busca é pelo valor
    // dentro da linha de confiança, não pelo texto solto na tela.
    expect(
      within(confidence).getByText('92%', { selector: '.review-readiness-confidence-value' }),
    ).toBeInTheDocument()
  })

  it('não afirma certeza: o rótulo é do modelo, não da nota', () => {
    // A curva de calibração ainda não foi medida, então mostrar "92% de
    // certeza" prometeria uma validação que não existe.
    renderReport({ confidence: 0.92 })

    expect(screen.getByText('Confiança do modelo')).toBeInTheDocument()
    expect(screen.queryByText(/certeza/i)).not.toBeInTheDocument()
  })

  it('explica o rebaixamento quando o motor não ficou seguro do veredito', () => {
    renderReport({ status: 'ambiguous', confidence: 0.41, confidenceDegraded: true })

    const note = screen.getByTestId('review-readiness-confidence')
    expect(note).toHaveClass('is-degraded')
    expect(screen.getByText(/não ficou seguro deste veredito/i)).toBeInTheDocument()
    expect(screen.getByText('41%')).toBeInTheDocument()
  })

  it('não inventa degradação quando o veredito foi rebaixado com alta confiança', () => {
    // `ambiguous` com 95% de confiança é um veredito firme. O aviso de
    // degradação aqui seria informação falsa.
    renderReport({ status: 'ambiguous', confidence: 0.95, confidenceDegraded: false })

    expect(screen.getByTestId('review-readiness-confidence')).not.toHaveClass('is-degraded')
    expect(screen.queryByText(/não ficou seguro deste veredito/i)).not.toBeInTheDocument()
  })

  it('trata confiança nula como "o motor não informa", e não como zero', () => {
    renderReport({ confidence: null, statusProbabilities: null, confidenceDegraded: null })

    expect(screen.queryByTestId('review-readiness-confidence')).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('trata um relatório antigo sem os campos como ausente, e não como zero', () => {
    // Um vault salvo antes da confiança não tem a chave. Renderizar "0%" seria
    // afirmar descrença onde o documento só é antigo.
    //
    // O cast é deliberado e não é um atalho: `ReadinessAttempt` é o tipo do
    // **wire**, que vem do Rust atual e sempre traz as chaves. A ausência só
    // existe no documento **persistido**, cujo schema aceita a chave faltando.
    // Este caso entra pelo caminho do Vault antigo.
    const legacyReport = {
      status: 'ready',
      explanation: 'A nota tem material suficiente.',
      centralIdea: null,
      evaluablePoints: [],
      issues: [],
    } as unknown as ReadinessReport
    const legacy = {
      outcome: 'valid',
      sourceHash: `sha256:${'c'.repeat(64)}`,
      report: legacyReport,
    } as ReadinessAttempt
    render(
      <NoteReadinessReport
        attempt={legacy}
        isStaleReport={false}
        error=""
        busy={false}
        onClose={() => {}}
        onRetry={() => {}}
      />,
    )

    expect(screen.queryByTestId('review-readiness-confidence')).not.toBeInTheDocument()
    // O veredito continua legível: a ausência da confiança é a ausência da
    // informação, não a ausência do relatório.
    expect(
      screen.getByRole('heading', { name: 'Pronta para revisão' }),
    ).toBeInTheDocument()
  })

  it('recolhe a distribuição por status e mostra os três rótulos', () => {
    renderReport()

    const detail = screen.getByText('Como o modelo distribuiu as probabilidades')
    expect(detail).toBeInTheDocument()
    expect(screen.getByText('Ambígua')).toBeInTheDocument()
    expect(screen.getByText('Insuficiente')).toBeInTheDocument()
  })

  it('omite a distribuição quando o motor não mandou probabilidades', () => {
    renderReport({ statusProbabilities: null })

    expect(screen.getByTestId('review-readiness-confidence')).toBeInTheDocument()
    expect(
      screen.queryByText('Como o modelo distribuiu as probabilidades'),
    ).not.toBeInTheDocument()
  })

  it('arredonda a confiança em vez de truncar', () => {
    // Truncar 0.889 para "88%" subestimaria; arredondar mostra o que o motor
    // disse ao pé da letra.
    renderReport({ confidence: 0.889 })

    expect(screen.getByText('89%')).toBeInTheDocument()
  })

  it('mostra 0% quando o motor realmente disse zero', () => {
    // O caso oposto ao `null`, e precisa ser distinguido dele.
    renderReport({ confidence: 0, confidenceDegraded: true })

    expect(screen.getByText('0%')).toBeInTheDocument()
  })
})