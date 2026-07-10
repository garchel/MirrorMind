import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { BUILDER_FRIENDLY_NAMES } from '../lib/ui-structure'

type BuilderModeControlProps = {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
}

type TooltipState = {
  name: string
  x: number
  y: number
}

const INITIAL_POSITION = { x: 24, y: 24 }

export function BuilderModeControl({ enabled, onEnabledChange }: BuilderModeControlProps) {
  const [position, setPosition] = useState(INITIAL_POSITION)
  const [isDragging, setIsDragging] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)
  const movedDuringDrag = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setTooltip(null)
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null
      const namedComponent = target?.closest<HTMLElement>('[data-builder-name]')

      if (!namedComponent) {
        setTooltip(null)
        return
      }

      setTooltip({
        name:
          BUILDER_FRIENDLY_NAMES[namedComponent.dataset.builderName ?? ''] ??
          'Area sem nome amigavel',
        x: event.clientX + 14,
        y: event.clientY + 14,
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    return () => window.removeEventListener('pointermove', handlePointerMove)
  }, [enabled])

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragOrigin.current = { x: event.clientX, y: event.clientY }
    movedDuringDrag.current = false
    setIsDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isDragging) {
      return
    }

    const origin = dragOrigin.current
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 4) {
      movedDuringDrag.current = true
    }

    const nextX = Math.max(12, Math.min(window.innerWidth - 154, event.clientX - 64))
    const nextY = Math.max(12, Math.min(window.innerHeight - 44, event.clientY - 18))
    setPosition({ x: nextX, y: nextY })
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!movedDuringDrag.current) {
      onEnabledChange(!enabled)
    }

    event.currentTarget.releasePointerCapture(event.pointerId)
    dragOrigin.current = null
    setIsDragging(false)
  }

  return (
    <>
      <button
        type="button"
        className={`builder-mode-control${enabled ? ' is-enabled' : ''}${isDragging ? ' is-dragging' : ''}`}
        style={{ left: position.x, top: position.y }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-pressed={enabled}
        aria-label="Alternar Builder Mode"
      >
        <span aria-hidden="true">Build</span>
        <span>{enabled ? 'Builder ligado' : 'Builder desligado'}</span>
      </button>

      {tooltip?.name ? (
        <output className="builder-mode-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.name}
        </output>
      ) : null}
    </>
  )
}
