import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DictionaryEntry } from './dictionarySchema'

/**
 * O balão com o conceito, mostrado **acima** da palavra.
 *
 * ## Por que um balão e não um `title` nativo
 *
 * Um `title` do navegador demora um segundo e meio para aparecer, some
 * quando o mouse se move, e não tem styling. O `title` nativo também
 * prendia o cursor branco — o mesmo problema que o peek de post-it já
 * documentou (`markdownLivePreview.ts`).
 *
 * ## Por que um portal
 *
 * O balão é posicionado em `fixed`, e o editor tem `overflow` próprio: um
 * balão dentro da árvore do editor seria cortado pelas bordas. O portal o
 * tira de lá.
 */
export function DictionaryTooltip({
  entry,
  rect,
}: {
  entry: DictionaryEntry | null
  rect: DOMRect | null
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const bubbleRef = useRef<HTMLDivElement | null>(null)

  // Mede o balão para centraliza-lo sobre a palavra e mantê-lo dentro da
  // janela. A medicao precisa acontecer **depois** que o balão existir no
  // DOM, e nao antes.
  useLayoutEffect(() => {
    if (!entry || !rect) {
      setPosition(null)
      return
    }
    const bubble = bubbleRef.current
    const width = bubble?.offsetWidth ?? 0
    const height = bubble?.offsetHeight ?? 0
    const margin = 8
    const centered = rect.left + rect.width / 2 - width / 2
    const left = Math.max(margin, Math.min(centered, window.innerWidth - width - margin))
    // Acima da palavra. Quando não cabe (palavra no topo da janela), o
    // balão desce — um conceito escondido é pior do que um conceito na
    // posição errada.
    const above = rect.top - height - margin
    const top = above >= margin ? above : rect.bottom + margin
    setPosition({ top, left })
  }, [entry, rect])

  // O balão some quando o mouse sai da janela.
  useEffect(() => {
    if (!entry) return
    const onBlur = () => setPosition(null)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [entry])

  if (!entry || !rect) return null

  return createPortal(
    <div
      ref={bubbleRef}
      className="dictionary-tooltip"
      role="tooltip"
      data-testid="dictionary-tooltip"
      style={
        position
          ? { top: position.top, left: position.left }
          : { top: rect.top, left: rect.left, visibility: 'hidden' }
      }
    >
      <p className="dictionary-tooltip-term">{entry.term}</p>
      <p className="dictionary-tooltip-concept">{entry.concept}</p>
    </div>,
    document.body,
  )
}
