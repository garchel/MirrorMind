import { describe, expect, it } from 'vitest'
import { nextPopoverShiftX } from './selectionPopover'

describe('nextPopoverShiftX (contencao do popover de selecao)', () => {
  it('desloca para dentro dos limites e converge em uma correcao, sem oscilar', () => {
    // Popover de 315px centralizado em x=60 (proximo da borda esquerda) dentro
    // de um contêiner de 400px: a borda esquerda estoura em -97.5.
    const containerLeft = 0
    const containerRight = 400
    const width = 315
    let shiftX = 0
    const shifts: number[] = []

    for (let step = 0; step < 10; step += 1) {
      const center = 60 + shiftX
      shiftX = nextPopoverShiftX(center - width / 2, center + width / 2, containerLeft, containerRight, shiftX)
      shifts.push(shiftX)
    }

    // A primeira iteracao corrige para dentro (shiftX > 0) e a sequencia
    // estabiliza imediatamente nos valores seguintes, sem oscilar (o bug
    // antigo alternava shiftX entre o valor corrigido e 0 para sempre).
    expect(shifts[0]).toBeGreaterThan(0)
    expect(shifts.at(-1)).toBe(shifts.at(-2))
  })

  it('nao mexe no shiftX quando o popover ja esta contido', () => {
    const center = 200
    expect(nextPopoverShiftX(center - 100, center + 100, 0, 400, 0)).toBe(0)
    expect(nextPopoverShiftX(center - 100, center + 100, 0, 400, 42)).toBe(42)
  })

  it('empurra de volta para dentro quando estoura pela direita', () => {
    const center = 390
    const next = nextPopoverShiftX(center - 100, center + 100, 0, 400, 0)
    expect(next).toBe(-90)
  })
})
