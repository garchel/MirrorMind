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
          <span className="policy-workload-estimate-summary">
            {`≈ ${estimate.reviewsFirst30Days} ${estimate.reviewsFirst30Days === 1 ? 'revisão' : 'revisões'} em 30 dias`}
            <span className="policy-workload-estimate-sep" aria-hidden="true">·</span>
            {`≈ ${estimate.reviewsFirstYear} no primeiro ano`}
            <span className="policy-workload-estimate-sep" aria-hidden="true">·</span>
            {`estabiliza a cada ${formatInterval(estimate.steadyIntervalDays)}`}
          </span>
          <small className="policy-workload-estimate-note">
            Simulação com acertos consistentes (recall livre) na curva de esquecimento usada pelo
            agendamento. Use-a para calibrar retenção e intervalos.
          </small>
        </>
      ) : failed ? (
        <small className="policy-workload-estimate-note">Não foi possível estimar a carga.</small>
      ) : valid ? (
        <span className="policy-workload-estimate-summary policy-workload-estimate-loading" role="status">
          <Loader2 size={13} aria-hidden="true" />
          Calculando estimativa…
        </span>
      ) : null}
    </div>
  )
}
