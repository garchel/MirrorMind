import { useEffect, useRef, useState } from 'react'
import { ErrorState } from '../../components/ErrorState'
import { errorMessage } from '../../lib/tauri'
import { getRetentionReport, type RetentionReport, type TagRetentionItem } from './retentionReport'

/**
 * Aba "Minhas tags" do painel.
 *
 * A retencao por tag existia so no fim do relatorio de retencao — um dado
 * sobre TAGS enterrado numa pagina sobre DESEMPENHO, e sem nada que dissesse
 * o que fazer com ele. Aqui ela ganha o contexto que faltava: quantas notas a
 * tag carrega, quantas estao vencidas, e — o mais importante — a comparação
 * com a meta da PROPRIA tag.
 *
 * O alvo importa: `revisao/leve` tem meta menor (70%) que `revisao/prova`
 * (90%). Comparar as duas com um numero unico acusaria a leve de "ruim"
 * quando ela esta exatamente onde deveria. Por isso a barra mostra a retencao
 * e o numero ao lado mostra a distancia ate a meta daquela tag.
 */
type Props = {
  vaultPath: string
}

function percent(value: number | null): string {
  if (value === null) return '—'
  return `${Math.round(value * 100)}%`
}

function distancetoTarget(item: TagRetentionItem): number | null {
  if (item.averageRetrievability === null || item.targetRetention === null) return null
  return item.averageRetrievability - item.targetRetention
}

export function ReviewTagsSection({ vaultPath }: Props) {
  const [report, setReport] = useState<RetentionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadRequest, setReloadRequest] = useState(0)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(null)
    void getRetentionReport(vaultPath)
      .then((next) => {
        if (requestId === requestIdRef.current) setReport(next)
      })
      .catch((cause: unknown) => {
        if (requestId === requestIdRef.current) {
          setError(errorMessage(cause, 'Não foi possível carregar as tags.'))
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
  }, [vaultPath, reloadRequest])

  if (loading) {
    return <p className="review-tags-status" role="status">Carregando tags…</p>
  }
  if (error) {
    return <ErrorState message={error} onRetry={() => setReloadRequest((request) => request + 1)} />
  }
  if (!report) return null

  const tags = report.perTag
  const abaixoDaMeta = tags
    .map((item) => ({ item, distancia: distancetoTarget(item) }))
    .filter((entry): entry is { item: TagRetentionItem; distancia: number } => entry.distancia !== null)
    .sort((left, right) => left.distancia - right.distancia)
    .slice(0, 5)

  return (
    <>
      <div className="review-tags-summary">
        <p>
          <strong>{tags.length}</strong> {tags.length === 1 ? 'tag' : 'tags'} nas notas em aprendizado
        </p>
        <p>
          <strong>{abaixoDaMeta.length}</strong> abaixo da meta da própria tag
        </p>
      </div>

      <section className="review-tags-block" aria-labelledby="review-tags-table-title">
        <div className="review-dashboard-section-heading">
          <h3 id="review-tags-table-title">Como cada tag está indo</h3>
          <span>{tags.length === 1 ? '1 tag' : `${tags.length} tags`}</span>
        </div>
        {tags.length === 0 ? (
          <p className="review-dashboard-calibration-empty">
            Nenhuma nota em aprendizado tem tag. Marque as notas com uma tag de revisão para
            acompanhar a retenção por assunto.
          </p>
        ) : (
          <table className="review-tags-table">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col">Notas</th>
                <th scope="col">Vencidas</th>
                <th scope="col">Retenção</th>
                <th scope="col">Meta</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((item) => {
                const distancia = distancetoTarget(item)
                return (
                  <tr key={item.tag}>
                    <th scope="row">#{item.tag}</th>
                    <td className="review-tags-num">{item.noteCount}</td>
                    <td className="review-tags-num">{item.dueCount}</td>
                    <td>
                      <span
                        className={`review-tags-retention${distancia !== null && distancia < 0 ? ' is-abaixo' : ''}`}
                        title={
                          distancia !== null && distancia < 0
                            ? `${Math.abs(Math.round(distancia * 100))} pontos abaixo da meta`
                            : undefined
                        }
                      >
                        <span className="review-tags-bar" aria-hidden="true">
                          <span style={{ width: `${Math.round((item.averageRetrievability ?? 0) * 100)}%` }} />
                        </span>
                        {percent(item.averageRetrievability)}
                      </span>
                    </td>
                    <td className="review-tags-num">
                      {item.targetRetention === null ? '—' : percent(item.targetRetention)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="review-tags-block" aria-labelledby="review-tags-weak-title">
        <div className="review-dashboard-section-heading">
          <h3 id="review-tags-weak-title">Onde a retenção está abaixo da meta</h3>
          <span>o que revisar primeiro</span>
        </div>
        {abaixoDaMeta.length === 0 ? (
          <p className="review-dashboard-calibration-empty">
            Todas as tags estão na meta ou acima dela.
          </p>
        ) : (
          <ul className="review-tags-weak-list">
            {abaixoDaMeta.map(({ item, distancia }) => (
              <li key={item.tag}>
                <span className="review-tags-weak-name">#{item.tag}</span>
                <span className="review-tags-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round((item.averageRetrievability ?? 0) * 100)}%` }} />
                </span>
                <span className="review-tags-gap">
                  {Math.abs(Math.round(distancia * 100))} pontos abaixo da meta de {percent(item.targetRetention)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
