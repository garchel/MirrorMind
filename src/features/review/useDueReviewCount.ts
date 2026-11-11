import { useEffect, useState } from 'react'
import { getVaultReviewDashboard } from './reviewDashboard'

/**
 * Numero de notas vencidas para a badge do trilho.
 *
 * Usa o mesmo contador "Vencidas agora" do Painel: le o estado de
 * aprendizado sem reler o Markdown das notas. `null` significa "ainda nao
 * medido" (carregando, sem Vault ou falha de leitura). Nunca devolve 0 por
 * engano: a badge some em vez de afirmar que a fila esta vazia quando o dado
 * nao foi obtido.
 */
export function useDueReviewCount(
  vaultPath: string | null | undefined,
  refreshToken = 0,
): number | null {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!vaultPath) {
      setCount(null)
      return
    }

    let cancelled = false
    setCount(null)
    void getVaultReviewDashboard(vaultPath)
      .then((dashboard) => {
        if (!cancelled) setCount(dashboard.dueNoteCount)
      })
      .catch(() => {
        if (!cancelled) setCount(null)
      })

    return () => {
      cancelled = true
    }
  }, [vaultPath, refreshToken])

  return count
}
