import { memo, type CSSProperties, type MutableRefObject, type PointerEvent } from 'react'
import { Button } from '../../components/ui/Button'

/** Handlers do no, guardados num ref estavel: se cada no recebesse closures
 *  novas a cada render do GraphPage, `memo` nunca casaria e o hover voltaria a
 *  re-renderizar a arvore inteira. */
export type Graph2dNodeHandlers = {
  hover: (relativePath: string) => void
  open: (relativePath: string) => void
  dragStart: (relativePath: string, event: PointerEvent<HTMLButtonElement>) => void
  dragMove: (relativePath: string, event: PointerEvent<HTMLButtonElement>) => void
  dragEnd: (event: PointerEvent<HTMLButtonElement>) => void
  dragCancel: () => void
  focus: (relativePath: string) => void
  register: (relativePath: string, element: HTMLButtonElement | null) => void
}

export type Graph2dNodeProps = {
  relativePath: string
  /** Nome sem `.md`, ja calculado pelo pai. */
  label: string
  degree: number
  isCurrent: boolean
  isFocused: boolean
  isFilterMatch: boolean
  isFilteredOut: boolean
  leftPercent: number
  topPercent: number
  dotScale: number
  folderColor: string | null
  /** Nome escondido por zoom/configuracao (o hover liga de novo — imperativo). */
  labelHidden: boolean
  handlersRef: MutableRefObject<Graph2dNodeHandlers>
}

/**
 * No do grafo 2D, memoizado.
 *
 * O hover NAO aparece nas props: `is-hovered`, `is-dimmed` e a visibilidade do
 * nome sao aplicados por um efeito imperativo no GraphPage, direto no DOM.
 * Medido: com o hover no estado do React, cada troca de no custava 20ms em 300
 * nos (p95 60ms) e 37ms em 600 (p95 90ms) — o mouse atravessando a tela virava
 * uma fila de renders. Com as classes fora do JSX, o React nao reconcilia nada
 * durante o hover; so o efeito percorre os elementos.
 */
export const Graph2dNode = memo(function Graph2dNode({
  relativePath,
  label,
  degree,
  isCurrent,
  isFocused,
  isFilterMatch,
  isFilteredOut,
  leftPercent,
  topPercent,
  dotScale,
  folderColor,
  labelHidden,
  handlersRef,
}: Graph2dNodeProps) {
  const className = `note-graph-node${isCurrent ? ' is-current' : ''}${isFocused ? ' is-focused' : ''}${isFilterMatch ? ' is-match' : ''}${isFilteredOut ? ' is-filtered-out' : ''}`
  return (
    <Button
      type="button"
      className={className}
      style={{ left: `${leftPercent}%`, top: `${topPercent}%` } as CSSProperties}
      ref={(element) => handlersRef.current.register(relativePath, element)}
      onPointerEnter={() => handlersRef.current.hover(relativePath)}
      onPointerDown={(event) => handlersRef.current.dragStart(relativePath, event)}
      onPointerMove={(event) => handlersRef.current.dragMove(relativePath, event)}
      onPointerUp={(event) => handlersRef.current.dragEnd(event)}
      onPointerCancel={() => handlersRef.current.dragCancel()}
      onFocus={() => handlersRef.current.focus(relativePath)}
      onClick={() => handlersRef.current.open(relativePath)}
      aria-label={`Abrir nota ${label} no grafo`}
      title={`${label}${degree ? `, ${degree} conexão(ões)` : ''}`}
    >
      <span
        className="note-graph-node-dot"
        style={{
          '--graph-scale': dotScale,
          ...(folderColor ? { '--node-folder-color': folderColor } : {}),
        } as CSSProperties}
      />
      <span className={`note-graph-node-label${labelHidden ? ' is-hidden' : ''}`}>{label}</span>
    </Button>
  )
})
