import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { estimateReviewWorkload } from './reviewWorkload'
import type { WorkloadEstimate } from './reviewWorkload'
import './policy-workload-estimate.css'

type Props = {
  firstReviewIntervalDays: number
  targetRetention: number
  minIntervalDays: number
  maxIntervalDays: number
  /**
   * Quando a política ainda não é válida (intervalos inconsistentes), a
   * estimativa é omitida em vez de exibir valores enganosos.
   */
  valid?: boolean
}

function formatInterval(days: number) {
  if (days <= 1) return '1 dia'
  if (days < 30) return `${days} dias`
  if (days < 365) {
    const months = Math.round(days / 30)
    return `cerca de ${months} ${months === 1 ? 'mês' : 'meses'}`
  }
  const years = Math.round(days / 365)
  return `cerca de ${years} ${years === 1 ? 'ano' : 'anos'}`
}

export function PolicyWorkloadEstimate({
  firstReviewIntervalDays,
  targetRetention,
  minIntervalDays,
  maxIntervalDays,
  valid = true,
}: Props) {
  const [estimate, setEstimate] = useState<WorkloadEstimate | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setEstimate(null)
    setFailed(false)
    if (!valid) return () => { cancelled = true }
    void estimateReviewWorkload({
      firstReviewIntervalDays,
      targetRetention,
      minIntervalDays,
      maxIntervalDays,
    })
      .then((next) => {
        if (!cancelled) setEstimate(next)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [firstReviewIntervalDays, maxIntervalDays, minIntervalDays, targetRetention, valid])

  // Politica ainda nao valida: nenhuma estimativa util para exibir.
  if (!valid) return null

  return (
    <div className="policy-workload-estimate" aria-label="Estimativa de carga da política">
      {estimate ? (
        <>
          <div className="policy-workload-stats">
            <div className="policy-workload-stat">
              <strong>≈ {estimate.reviewsFirst30Days}</strong>
              <span>{estimate.reviewsFirst30Days === 1 ? 'revisão em 30 dias' : 'revisões em 30 dias'}</span>
            </div>
            <div className="policy-workload-stat">
              <strong>≈ {estimate.reviewsFirstYear}</strong>
              <span>no primeiro ano</span>
            </div>
            <div className="policy-workload-stat">
              <strong>{formatInterval(estimate.steadyIntervalDays)}</strong>
              <span>entre revisões ao estabilizar</span>
            </div>
          </div>
          <small className="policy-workload-estimate-note">
            Simulação com acertos constantes — ajuste retenção e intervalos para calibrar a carga.
          </small>
        </>
      ) : failed ? (
        <small className="policy-workload-estimate-note">Falha ao estimar a carga.</small>
      ) : valid ? (
        <span className="policy-workload-estimate-summary policy-workload-estimate-loading" role="status">
          <Loader2 size={13} aria-hidden="true" />
          Calculando estimativa…
        </span>
      ) : null}
    </div>
  )
}
