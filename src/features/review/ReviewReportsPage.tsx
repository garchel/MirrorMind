import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, ClipboardList, ExternalLink } from 'lucide-react'
import { ErrorState, LoadingState } from '../../components/ErrorState'
import { PageHeader, PageRefreshButton } from '../../components/PageHeader'
import { getReviewReports, type ReviewReportItem } from './reviewReports'
import { getRetentionReport, type RetentionReport } from './retentionReport'
import './review-reports.css'

type Props = {
  vaultPath: string
  onOpenNote: (relativePath: string) => void
}

const outcomeLabels: Record<NonNullable<ReviewReportItem['outcome']>, string> = {
  forgotten: 'Esquecida',
  partial: 'Difícil',
  good: 'Boa',
  complete: 'Completa',
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })

function formatDate(timestamp: number | null) {
  return timestamp === null ? '—' : dateFormatter.format(new Date(timestamp))
}

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

/** Grafico de linhas SVG sem dependencias: media das notas por dia. */
function EvolutionChart({ points }: { points: RetentionReport['evolution'] }) {
  const width = 640
  const height = 180
  const padX = 34
  const padTop = 14
  const padBottom = 26
  const innerW = width - padX - 14
  const innerH = height - padTop - padBottom

  const scored = points.filter((point) => point.averageScore !== null)
  const hasData = scored.length > 0

  const { path, dots, labels } = useMemo(() => {
    const labels: { x: number; text: string; point: (typeof points)[number] }[] = []
    const xFor = (index: number) => (points.length <= 1 ? padX : padX + (index / (points.length - 1)) * innerW)
    const yFor = (score: number) => padTop + (1 - score / 100) * innerH
    const dots = scored.map((point) => ({
      x: xFor(points.indexOf(point)),
      y: yFor(point.averageScore!),
      point,
    }))
    const path = dots
      .map((dot, index) => `${index === 0 ? 'M' : 'L'}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`)
      .join(' ')
    // Rotulos: primeiro, ultimo e o meio com dados, para nao poluir.
    if (dots.length > 0) {
      const pick = (index: number) => dots[index]?.x ?? padX
      labels.push({ x: pick(0), text: shortDateFormatter.format(new Date(dots[0].point.dayStartUnixMs)), point: dots[0].point })
      if (dots.length > 2) {
        const middle = dots[Math.floor(dots.length / 2)]
        labels.push({ x: middle.x, text: shortDateFormatter.format(new Date(middle.point.dayStartUnixMs)), point: middle.point })
      }
      labels.push({ x: pick(dots.length - 1), text: shortDateFormatter.format(new Date(dots[dots.length - 1].point.dayStartUnixMs)), point: dots[dots.length - 1].point })
    }
    return { path, dots, labels }
  }, [points, scored, innerW, innerH, padX, padTop])

  if (!hasData) {
    return (
      <div className="retention-evolution-empty">
        <BarChart3 size={18} strokeWidth={1.4} aria-hidden="true" />
        <span>Conclua revisões para ver a evolução do desempenho aqui.</span>
      </div>
    )
  }

  return (
    <div className="retention-evolution-chart" role="img" aria-label="Gráfico da média das notas por dia">
      <svg viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true">
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padTop + (1 - tick / 100) * innerH
          return (
            <g key={tick}>
              <line x1={padX} y1={y} x2={width - 14} y2={y} className="retention-evolution-gridline" />
              <text x={padX - 6} y={y + 3} textAnchor="end" className="retention-evolution-axis">
                {tick}
              </text>
            </g>
          )
        })}
        <polyline points={path} className="retention-evolution-line" fill="none" />
        {dots.map((dot, index) => (
          <circle key={index} cx={dot.x} cy={dot.y} r={3.5} className="retention-evolution-dot">
            <title>
              {shortDateFormatter.format(new Date(dot.point.dayStartUnixMs))}:{' '}
              {dot.point.averageScore === null ? 'sem nota' : `${Math.round(dot.point.averageScore)}/100`}
              {' · '}
              {dot.point.sessionCount} {dot.point.sessionCount === 1 ? 'sessão' : 'sessões'}
            </title>
          </circle>
        ))}
        {labels.map((label, index) => (
          <text key={index} x={label.x} y={height - 8} textAnchor="middle" className="retention-evolution-axis">
            {label.text}
          </text>
        ))}
      </svg>
    </div>
  )
}

export function ReviewReportsPage({ vaultPath, onOpenNote }: Props) {
  const [reports, setReports] = useState<ReviewReportItem[]>([])
  const [retention, setRetention] = useState<RetentionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    void Promise.all([getReviewReports(vaultPath), getRetentionReport(vaultPath)])
      .then(([nextReports, nextRetention]) => {
        if (requestId !== requestIdRef.current) return
        setReports(nextReports)
        setRetention(nextRetention)
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Não foi possível carregar os relatórios de revisão.')
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [vaultPath, reloadRequest])

  const overall = retention?.overall ?? null

  return (
    <section className="workspace-page review-reports-page" aria-labelledby="review-reports-title">
      <PageHeader
        kicker="Aprendizado"
        title="Relatórios"
        titleId="review-reports-title"
        description="Retenção estimada, desempenho ao longo do tempo e todas as provas e conversas concluídas."
      >
        <PageRefreshButton onRefresh={() => setReloadRequest((request) => request + 1)} disabled={loading} />
      </PageHeader>

      {loading ? (
        <LoadingState message="Carregando relatórios..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadRequest((request) => request + 1)} />
      ) : (
        <>
          {overall !== null && (
            <section className="retention-section" aria-labelledby="retention-title">
              <div className="retention-heading">
                <div>
                  <h3 id="retention-title">Retenção estimada</h3>
                  <p>Recuperabilidade das unidades, com a passagem do tempo desde a última revisão.</p>
                </div>
              </div>

              <div className="retention-cards">
                <div className="retention-card">
                  <span className="retention-card-label">Retenção média</span>
                  <strong className="retention-card-value">{percent(overall.averageRetrievability)}</strong>
                  <small>{overall.trackedUnitCount} {overall.trackedUnitCount === 1 ? 'unidade' : 'unidades'} rastreadas</small>
                </div>
                <div className="retention-card">
                  <span className="retention-card-label">Estabilidade média</span>
                  <strong className="retention-card-value">
                    {overall.averageStabilityDays === null ? '—' : `${overall.averageStabilityDays.toFixed(1)}d`}
                  </strong>
                  <small>tempo que o conteúdo resiste sem revisão</small>
                </div>
                <div className="retention-card">
                  <span className="retention-card-label">Unidades frágeis</span>
                  <strong className="retention-card-value">{overall.fragileUnitCount}</strong>
                  <small>retenção abaixo do limiar de fragilidade — revisem em breve</small>
                </div>
                <div className="retention-card">
                  <span className="retention-card-label">Sessões concluídas</span>
                  <strong className="retention-card-value">{overall.completedSessionCount}</strong>
                  <small>{overall.enrolledNoteCount} {overall.enrolledNoteCount === 1 ? 'nota inscrita' : 'notas inscritas'}</small>
                </div>
              </div>

              <div className="retention-layout">
                {retention && retention.perTag.length > 0 && (
                  <div className="retention-tags">
                    <h4>Por tag</h4>
                    <table className="retention-tags-table" aria-label="Retenção estimada por tag">
                      <thead>
                        <tr>
                          <th scope="col">Tag</th>
                          <th scope="col">Notas</th>
                          <th scope="col">Retenção</th>
                          <th scope="col">Frágeis</th>
                        </tr>
                      </thead>
                      <tbody>
                        {retention.perTag.map((item) => (
                          <tr key={item.tag}>
                            <td>
                              <span className="retention-tag-name">#{item.tag}</span>
                              <small>{item.unitCount} {item.unitCount === 1 ? 'unidade' : 'unidades'}</small>
                            </td>
                            <td>{item.noteCount}</td>
                            <td>
                              <div className="retention-bar-wrap">
                                <div
                                  className={`retention-bar${item.averageRetrievability !== null && item.averageRetrievability < 0.6 ? ' is-fragile' : ''}`}
                                  style={{ width: `${Math.round((item.averageRetrievability ?? 0) * 100)}%` }}
                                />
                              </div>
                              <span className="retention-bar-value">{percent(item.averageRetrievability)}</span>
                            </td>
                            <td>{item.fragileUnitCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="retention-evolution">
                  <h4>Evolução do desempenho</h4>
                  <p className="retention-evolution-note">Média das notas das sessões por dia (últimos 30 dias).</p>
                  {retention && <EvolutionChart points={retention.evolution} />}
                </div>
              </div>
            </section>
          )}

          <section className="review-reports-list" aria-labelledby="review-reports-list-title">
            <div className="retention-heading">
              <div>
                <h3 id="review-reports-list-title">Histórico completo</h3>
                <p>Todas as provas e conversas concluídas, para acompanhar o seu progresso.</p>
              </div>
            </div>

            {reports.length === 0 ? (
              <div className="review-reports-status is-empty">
                <ClipboardList size={22} strokeWidth={1.4} aria-hidden="true" />
                <strong>Nenhum relatório ainda.</strong>
                <p>Conclua uma prova ou conversa de revisão para que o relatório apareça aqui.</p>
              </div>
            ) : (
              <div className="review-reports-table-wrap">
                <table className="review-reports-table" aria-label="Relatórios de revisão concluídos">
                  <thead>
                    <tr>
                      <th scope="col">Nota</th>
                      <th scope="col">Data</th>
                      <th scope="col">Modo</th>
                      <th scope="col">Pontuação</th>
                      <th scope="col">Resultado</th>
                      <th scope="col">Lacunas</th>
                      <th scope="col">Próxima revisão</th>
                      <th scope="col"><span className="review-reports-actions-label">Abrir</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report.sessionId}>
                        <td className="review-reports-note">
                          <strong>{report.title}</strong>
                          <small>{report.relativePath}</small>
                        </td>
                        <td>{formatDate(report.completedAtUnixMs)}</td>
                        <td>{report.mode === 'exam' ? 'Prova' : 'Conversa'}</td>
                        <td>
                          {report.overallScore === null ? (
                            <span className="review-reports-score is-inconclusive">—</span>
                          ) : (
                            <span className={`review-reports-score is-${report.outcome}`}>
                              {report.overallScore}/100
                            </span>
                          )}
                        </td>
                        <td>{report.outcome === null ? '—' : outcomeLabels[report.outcome]}</td>
                        <td>{report.gapCount}</td>
                        <td>{formatDate(report.nextReviewAtUnixMs)}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary-button review-reports-open"
                            onClick={() => onOpenNote(report.relativePath)}
                            aria-label={`Abrir nota ${report.title}`}
                          >
                            <ExternalLink size={13} aria-hidden="true" />
                            Abrir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}
