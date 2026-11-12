/**
 * A linha do tempo do placeholder que "digita" os modos de busca.
 *
 * Por que uma funcao pura
 * -----------------------
 * O texto do placeholder e uma funcao do tempo decorrido, e nao um acumulador
 * de estado: `texto = f(frases, ms)`. Assim o desenho pode ser testado sem
 * timer nenhum (basta chamar com `ms` fixo), a animacao nunca "perde" um
 * caractere por causa de um frame descartado e reiniciar o ciclo e so zerar o
 * relogio — nao ha um estado a desfazer.
 *
 * O desenho do ciclo
 * ------------------
 * Cada frase passa por quatro fases, nesta ordem:
 *
 *     digitar (typeMs por caractere) -> segurar (holdMs)
 *       -> apagar (deleteMs por caractere) -> respiro (gapMs)
 *
 * Terminada a ultima fase da ultima frase o ciclo recomeca na primeira. A
 * primeira frase comeca vazia: o placeholder "chega" digitado, nao aparece
 * inteiro para depois piscar.
 */

export type TypedPlaceholderTiming = {
  /** Milissegundos por caractere enquanto a frase e digitada. */
  typeMs: number
  /** Milissegundos por caractere enquanto a frase e apagada. */
  deleteMs: number
  /** Pausa com a frase completa na tela. */
  holdMs: number
  /** Respiro entre o fim de uma frase e o comeco da proxima. */
  gapMs: number
}

/** Ritmo medido para uma pilula de busca estreita: a frase mais longa
 *  ("Buscar por conceito", 18 caracteres) leva ~1,1 s para aparecer, fica
 *  1,6 s legivel, sai em ~0,5 s e da 0,32 s de respiro antes da proxima. */
export const TYPED_PLACEHOLDER_TIMING: TypedPlaceholderTiming = {
  typeMs: 62,
  deleteMs: 28,
  holdMs: 1600,
  gapMs: 320,
}

/** Piso para as divisoes: um `0` no ritmo nao pode virar `Infinity`/`NaN`. */
function duration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

type Phase =
  | { kind: 'typing'; length: number }
  | { kind: 'holding'; phrase: string }
  | { kind: 'deleting'; length: number }
  | { kind: 'gap' }

/** Fases de uma frase, na ordem em que acontecem. */
function phasesFor(phrase: string): Phase[] {
  const length = phrase.length
  return [
    { kind: 'typing', length },
    { kind: 'holding', phrase },
    { kind: 'deleting', length },
    { kind: 'gap' },
  ]
}

function phaseDuration(phase: Phase, timing: TypedPlaceholderTiming): number {
  switch (phase.kind) {
    case 'typing':
      return phase.length * duration(timing.typeMs)
    case 'deleting':
      return phase.length * duration(timing.deleteMs)
    case 'holding':
      return duration(timing.holdMs)
    case 'gap':
      return duration(timing.gapMs)
  }
}

/** Texto visivel dentro de uma fase, com o deslocamento ja normalizado. */
function phaseText(phrase: string, phase: Phase, localMs: number, timing: TypedPlaceholderTiming): string {
  switch (phase.kind) {
    case 'typing': {
      // `+ 1`: no instante zero a primeira letra ja esta na tela e a frase
      // fecha completa no fim da fase (sem depender do primeiro frame da
      // pausa) — cada caractere ocupa exatamente um `typeMs`.
      const typed = Math.floor(localMs / duration(timing.typeMs)) + 1
      return phrase.slice(0, Math.min(phrase.length, typed))
    }
    case 'holding':
      return phrase
    case 'deleting': {
      // `ceil` no apagamento: com `floor` o primeiro caractere ficaria na tela
      // durante um `deleteMs` inteiro e a frase pareceria travada no inicio.
      const removed = Math.ceil(localMs / duration(timing.deleteMs))
      return phrase.slice(0, Math.max(0, phrase.length - removed))
    }
    case 'gap':
      return ''
  }
}

/**
 * Texto do placeholder em `elapsedMs` do ciclo.
 *
 * Aceita tempo negativo (relogios monotonos podem ser lidos antes do marco
 * zero) e devolve `''` quando nao ha frase nenhuma.
 */
export function typedPlaceholderText(
  phrases: readonly string[],
  elapsedMs: number,
  timing: TypedPlaceholderTiming = TYPED_PLACEHOLDER_TIMING,
): string {
  if (phrases.length === 0) return ''
  const first = phrases[0] ?? ''
  if (phrases.length === 1 && first.length === 0) return ''

  const cycle = phrases.map((phrase) => phasesFor(phrase))
  const total = cycle
    .flat()
    .reduce((sum, phase) => sum + phaseDuration(phase, timing), 0)
  if (total <= 0) return first

  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0
  let offset = ((elapsed % total) + total) % total

  for (let index = 0; index < cycle.length; index++) {
    const phrase = phrases[index] ?? ''
    for (const phase of cycle[index] ?? []) {
      const span = phaseDuration(phase, timing)
      if (offset < span) return phaseText(phrase, phase, offset, timing)
      offset -= span
    }
  }

  // Inalcancavel com `offset < total`; devolve o estado "parado" para que uma
  // mudanca futura no calculo nunca pinte um placeholder fora do desenho.
  return ''
}

/** Duracao de um ciclo completo (as duas frases, com pausas). */
export function typedPlaceholderCycleMs(
  phrases: readonly string[],
  timing: TypedPlaceholderTiming = TYPED_PLACEHOLDER_TIMING,
): number {
  return phrases
    .flatMap((phrase) => phasesFor(phrase))
    .reduce((sum, phase) => sum + phaseDuration(phase, timing), 0)
}
