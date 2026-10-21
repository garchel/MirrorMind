import { useEffect, useState } from 'react'
import { getNoteCalibrationDivergence, type NoteCalibrationDivergence } from './calibrationComparison'

/**
 * A divergencia do motor, mostrada **na nota**.
 *
 * A tela de comparacao nas configuracoes mostra o agregado; o agregado nao
 * diz o que fazer com esta nota. Aqui a divergencia aparece junto do relatorio
 * de prontidao — que e onde o usuario esta decidindo.
 *
 * So aparece quando os dois motores discordaram. Um registro de acordo nao e
 * informacao, e poluir o relatorio com ele esconde a unica coisa que importa.
 */
export function NoteCalibrationDivergenceNote({
  vaultPath,
  relativePath,
}: {
  vaultPath?: string
  relativePath: string
}) {
  const [divergence, setDivergence] = useState<NoteCalibrationDivergence | null>(null)

  useEffect(() => {
    if (!vaultPath) {
      setDivergence(null)
      return
    }
    let active = true
    void getNoteCalibrationDivergence(vaultPath, relativePath)
      .then((next) => {
        if (active) setDivergence(next)
      })
      .catch(() => {
        // Falha aqui e silenciosa de proposito: a divergencia e um extra, e a
        // avaliacao da nota nao pode depender dela.
        if (active) setDivergence(null)
      })
    return () => {
      active = false
    }
  }, [vaultPath, relativePath])

  if (!divergence) return null

  return (
    <p className="review-readiness-divergence" role="note">
      <strong>Os dois motores discordaram desta nota.</strong>{' '}
      <span>
        {divergence.primaryEngine} disse “{divergence.primaryLabel ?? '—'}”
        {divergence.primaryConfidence !== null
          ? ` (${(divergence.primaryConfidence * 100).toFixed(0)}% de confiança)`
          : ''}
        , e {divergence.secondaryEngine} disse “{divergence.secondaryLabel ?? '—'}”.
      </span>
    </p>
  )
}
