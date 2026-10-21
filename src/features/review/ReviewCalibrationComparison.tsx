import { useEffect, useState } from 'react'
import { getCalibrationComparison, type CalibrationComparison } from './calibrationComparison'

/**
 * Painel de comparação entre os dois motores.
 *
 * Aparece quando a estratégia é `Dual`: é o único modo em que os dois motores
 * são executados e o lado secundário vai para o sidecar. Fora dele, o painel
 * diz por que está vazio — uma lista vazia sem explicação parece um bug.
 */
export function ReviewCalibrationComparison({ vaultPath }: { vaultPath?: string }) {
  const [comparison, setComparison] = useState<CalibrationComparison | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!vaultPath) {
      setComparison(null)
      return
    }
    let active = true
    void getCalibrationComparison(vaultPath)
      .then((next) => {
        if (active) {
          setComparison(next)
          setError('')
        }
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      active = false
    }
  }, [vaultPath])

  if (!vaultPath) return null
  if (error) {
    return (
      <section className="review-calibration-comparison" aria-label="Comparacao dos motores">
        <p className="field-error" role="alert">{error}</p>
      </section>
    )
  }
  if (!comparison) return null

  if (!comparison.collecting) {
    return (
      <section className="review-calibration-comparison" aria-label="Comparacao dos motores">
        <p className="review-calibration-comparison-empty">
          A comparação entre os motores só acontece no modo <strong>Comparar (dual)</strong>.
          Com ele ligado, cada avaliação guarda o veredito dos dois lado a lado, e as
          divergências aparecem aqui.
        </p>
      </section>
    )
  }

  if (comparison.total === 0) {
    return (
      <section className="review-calibration-comparison" aria-label="Comparacao dos motores">
        <p className="review-calibration-comparison-empty">
          Nenhuma avaliação comparada ainda. Avalie uma nota com o modo <strong>Comparar
          (dual)</strong> ligado e o registro aparece aqui.
        </p>
      </section>
    )
  }

  return (
    <section className="review-calibration-comparison" aria-label="Comparacao dos motores">
      <header className="review-calibration-comparison-header">
        <h3>Comparação dos motores</h3>
        <p>
          <strong>{comparison.divergences}</strong> de <strong>{comparison.total}</strong>{' '}
          avaliações divergiram
          {comparison.divergenceRate !== null
            ? ` (${(comparison.divergenceRate * 100).toFixed(0)}%)`
            : ''}
          .
        </p>
      </header>
      {comparison.recent.length ? (
        <ul className="review-calibration-comparison-list">
          {comparison.recent.map((divergence) => (
            <li
              key={`${divergence.relativePath}-${divergence.atUnixMs}`}
              className="review-calibration-divergence"
            >
              <div className="review-calibration-divergence-note">
                <strong>{divergence.relativePath}</strong>
                <span>{divergence.dimension}</span>
              </div>
              <div className="review-calibration-divergence-verdicts">
                <span className="is-primary">
                  {divergence.primaryEngine}: {divergence.primaryLabel ?? '—'}
                  {divergence.primaryConfidence !== null
                    ? ` (${(divergence.primaryConfidence * 100).toFixed(0)}%)`
                    : ''}
                </span>
                <span className="is-secondary">
                  {divergence.secondaryEngine}: {divergence.secondaryLabel ?? '—'}
                </span>
              </div>
              {divergence.primaryDistribution ? (
                <p className="review-calibration-divergence-distribution">
                  {Object.entries(divergence.primaryDistribution)
                    .map(([name, value]) => `${name} ${(value * 100).toFixed(0)}%`)
                    .join(' · ')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="review-calibration-comparison-empty">
          Nenhuma divergência até agora: os dois motores concordaram em todas as
          avaliações.
        </p>
      )}
    </section>
  )
}
