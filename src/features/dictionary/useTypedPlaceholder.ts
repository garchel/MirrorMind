import { useEffect, useMemo, useRef, useState } from 'react'
import { TYPED_PLACEHOLDER_TIMING, typedPlaceholderText, type TypedPlaceholderTiming } from './typedPlaceholder'

/** Intervalo minimo entre recalculares quando `requestAnimationFrame` nao
 *  existe (jsdom sem `pretendToBeVisual`, ambientes antigos). */
const FALLBACK_TICK_MS = 40

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Movimento reduzido (ou ambiente sem `matchMedia`, como o jsdom): o
 *  placeholder fica estatico na primeira frase. Animacao decorativa nao
 *  justifica contrariar a preferencia do sistema. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/**
 * Placeholder que se digita sozinho, alternando as frases do ciclo descrito em
 * `typedPlaceholder.ts`.
 *
 * `paused` congela o texto onde ele esta: com o campo em foco (ou ja com
 * texto) o placeholder fica visivel enquanto o usuario digita, e uma frase
 * mudando de tamanho embaixo do cursor distrai. Ao despausar o ciclo recomeca
 * do zero — retomar de um meio de palavra daria a impressao de que a frase
 * "pulou".
 *
 * As frases e o ritmo entram por ref: sao constantes do modulo que chama este
 * hook, e depender da identidade do array/objeto reiniciaria o ciclo a cada
 * render do dono (bastaria o campo ser controlado).
 */
export function useTypedPlaceholder(
  phrases: readonly string[],
  options: { paused?: boolean; timing?: TypedPlaceholderTiming } = {},
): string {
  const { paused = false, timing = TYPED_PLACEHOLDER_TIMING } = options
  const reducedMotion = useMemo(prefersReducedMotion, [])
  const staticText = phrases[0] ?? ''

  const phrasesRef = useRef(phrases)
  phrasesRef.current = phrases
  const timingRef = useRef(timing)
  timingRef.current = timing

  const [text, setText] = useState(() => (reducedMotion ? staticText : ''))

  useEffect(() => {
    if (reducedMotion || paused) return
    setText((current) => (current === '' ? current : ''))
    const startedAt = performance.now()

    // O desenho vem do relogio, nao do numero de tiques: um frame atrasado nao
    // "atrasa a frase", so pula letras que ja deveriam ter passado. Por isso
    // `requestAnimationFrame` (e nao `setInterval`) — em aba/janela oculta o
    // navegador estrangula timers para ~1 s, e o texto apareceria em blocos.
    // Escondido o `rAF` simplesmente nao chama, que e o comportamento certo.
    let handle = 0
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      const next = typedPlaceholderText(
        phrasesRef.current,
        performance.now() - startedAt,
        timingRef.current,
      )
      // `setState` com o mesmo texto nao re-renderiza (React descarta), entao
      // os ~60 callbacks por segundo custam so um `slice`.
      setText((current) => (current === next ? current : next))
      handle = window.requestAnimationFrame(tick)
    }

    if (typeof window.requestAnimationFrame === 'function') {
      handle = window.requestAnimationFrame(tick)
      return () => {
        cancelled = true
        window.cancelAnimationFrame(handle)
      }
    }

    handle = window.setInterval(tick, FALLBACK_TICK_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [paused, reducedMotion])

  return reducedMotion ? staticText : text
}
