/** Deslocamento horizontal (shiftX) para conter um popover centralizado no
 * ponto de ancoragem dentro do contêiner (o popover usa translateX(-50%),
 * entao metade da sua largura pode estourar a borda quando a ancoragem esta
 * perto dela).
 *
 * O deslocamento e INCREMENTAL: soma o delta necessario sobre o shiftX atual.
 * Um alvo absoluto ("se em bounds, shiftX = 0") reseta a correcao no re-render
 * seguinte, estoura o popover de novo e oscila para sempre (max update depth).
 * Com delta, ao entrar nos limites o delta vira 0 e o estado estabiliza. */
export function nextPopoverShiftX(
  popoverLeft: number,
  popoverRight: number,
  containerLeft: number,
  containerRight: number,
  currentShiftX: number,
) {
  let deltaX = 0
  if (popoverLeft < containerLeft) deltaX = containerLeft - popoverLeft
  else if (popoverRight > containerRight) deltaX = containerRight - popoverRight
  return currentShiftX + deltaX
}
