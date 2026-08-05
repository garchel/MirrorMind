import { useEffect, useRef, useState } from 'react'
import { ClipboardList, ExternalLink, RefreshCw } from 'lucide-react'
import { getReviewReports, type ReviewReportItem } from './reviewReports'
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

function formatDate(timestamp: number | null) {
  return timestamp === null ? '—' : dateFormatter.format(new Date(timestamp))
}

export function ReviewReportsPage({ vaultPath, onOpenNote }: Props) {
  const [reports, setReports] = useState<ReviewReportItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    void getReviewReports(vaultPath)
      .then((nextReports) => {
        if (requestId === requestIdRef.current) setReports(nextReports)
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Não foi possível carregar os relatórios de revisão.')
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [vaultPath, reloadRequest])

  return (
    <section className="workspace-page review-reports-page" aria-labelledby="review-reports-title">
      <header className="review-reports-header">
        <div>
          <p className="review-queue-kicker">Aprendizado</p>
          <h2 id="review-reports-title">Relatórios</h2>
          <p>Todas as provas e conversas concluídas, para acompanhar o seu progresso.</p>
        </div>
        <button
          type="button"
          className="secondary-button review-reports-refresh"
          onClick={() => setReloadRequest((request) => request + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} aria-hidden="true" />
          Atualizar
        </button>
      </header>

      {loading ? (
        <div className="review-reports-status" role="status">Carregando relatórios...</div>
      ) : error ? (
        <div className="review-reports-status is-error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={() => setReloadRequest((request) => request + 1)}>
            Tentar novamente
          </button>
        </div>
      ) : reports.length === 0 ? (
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
  )
}
