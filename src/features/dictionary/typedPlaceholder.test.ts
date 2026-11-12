import { describe, expect, it } from 'vitest'
import {
  TYPED_PLACEHOLDER_TIMING,
  typedPlaceholderCycleMs,
  typedPlaceholderText,
} from './typedPlaceholder'

/** Ritmo curto para o teste: as fases ficam legiveis em numero redondo. */
const TIMING = { typeMs: 10, deleteMs: 5, holdMs: 100, gapMs: 40 }
const PHRASES = ['Buscar por conceito', 'Buscar por termo']

/** Com este `TIMING`, a primeira frase (19 caracteres) ocupa: digitar
 *  0-190, segurar 190-290, apagar 290-385 e respiro 385-425. A segunda frase
 *  (16 caracteres) repete o desenho a partir de 425. */
const SECOND_PHRASE = 425

describe('typedPlaceholderText', () => {
  it('comeca com a primeira letra ja na tela e digita um passo por vez', () => {
    expect(typedPlaceholderText(PHRASES, 0, TIMING)).toBe('B')
    expect(typedPlaceholderText(PHRASES, 9, TIMING)).toBe('B')
    expect(typedPlaceholderText(PHRASES, 10, TIMING)).toBe('Bu')
    expect(typedPlaceholderText(PHRASES, 100, TIMING)).toBe('Buscar por ')
  })

  it('fecha a frase completa no fim da digitacao', () => {
    expect(typedPlaceholderText(PHRASES, 189, TIMING)).toBe(PHRASES[0])
  })

  it('segura a frase inteira durante a pausa', () => {
    expect(typedPlaceholderText(PHRASES, 190, TIMING)).toBe(PHRASES[0])
    expect(typedPlaceholderText(PHRASES, 289, TIMING)).toBe(PHRASES[0])
  })

  it('apaga de volta e chega ao vazio sem pular caractere', () => {
    expect(typedPlaceholderText(PHRASES, 290, TIMING)).toBe(PHRASES[0])
    expect(typedPlaceholderText(PHRASES, 295, TIMING)).toBe('Buscar por conceit')
    expect(typedPlaceholderText(PHRASES, 384, TIMING)).toBe('')
  })

  it('da um respiro vazio antes da proxima frase', () => {
    expect(typedPlaceholderText(PHRASES, 385, TIMING)).toBe('')
    expect(typedPlaceholderText(PHRASES, 424, TIMING)).toBe('')
  })

  it('digita a segunda frase do zero', () => {
    expect(typedPlaceholderText(PHRASES, SECOND_PHRASE, TIMING)).toBe('B')
    expect(typedPlaceholderText(PHRASES, SECOND_PHRASE + 90, TIMING)).toBe('Buscar por')
  })

  it('repete o ciclo com o mesmo desenho', () => {
    const cycle = typedPlaceholderCycleMs(PHRASES, TIMING)
    expect(cycle).toBe(SECOND_PHRASE + 16 * 10 + 100 + 16 * 5 + 40)
    for (const offset of [0, 55, 200, 330, SECOND_PHRASE, 700]) {
      expect(typedPlaceholderText(PHRASES, offset + cycle, TIMING)).toBe(
        typedPlaceholderText(PHRASES, offset, TIMING),
      )
    }
  })

  it('normaliza tempo negativo em vez de sair do desenho', () => {
    const cycle = typedPlaceholderCycleMs(PHRASES, TIMING)
    expect(typedPlaceholderText(PHRASES, -1, TIMING)).toBe(typedPlaceholderText(PHRASES, cycle - 1, TIMING))
    expect(typedPlaceholderText(PHRASES, -cycle - 1, TIMING)).toBe(typedPlaceholderText(PHRASES, cycle - 1, TIMING))
  })

  it('nao quebra com uma frase so, sem frases ou com ritmo zero', () => {
    expect(typedPlaceholderText([], 0, TIMING)).toBe('')
    expect(typedPlaceholderText(['Solida'], 0, TIMING)).toBe('S')
    const zero = { typeMs: 0, deleteMs: 0, holdMs: 0, gapMs: 0 }
    expect(typedPlaceholderText(PHRASES, 0, zero)).not.toContain('NaN')
    expect(typedPlaceholderText(PHRASES, 500, zero)).toContain('Buscar')
  })

  it('o ritmo padrao nao troca de frase antes de dar tempo de ler', () => {
    // 1,6 s parado com a frase completa: o usuario precisa conseguir ler a
    // dica antes de ela comecar a apagar.
    const typing = PHRASES[0].length * TYPED_PLACEHOLDER_TIMING.typeMs
    expect(typedPlaceholderText(PHRASES, typing + TYPED_PLACEHOLDER_TIMING.holdMs - 1)).toBe(PHRASES[0])
    expect(typedPlaceholderText(PHRASES, 0)).toBe('B')
  })
})
