import { describe, expect, it } from 'vitest'
import { applyNoteExpansion } from './noteExpansionApply'

const NOTA = `# Notas

Carbono Fix (rubisco) = CO2 + ribulose

Depois, mais texto.`

/** A ancora: onde o trecho comeca na nota de teste. */
const INICIO = NOTA.indexOf('Carbono Fix')
const FIM = INICIO + 'Carbono Fix (rubisco) = CO2 + ribulose'.length

describe('applyNoteExpansion', () => {
  it('substitui o trecho pela frase completa', () => {
    const resultado = applyNoteExpansion(
      NOTA,
      {
        startUtf16: INICIO,
        endUtf16: FIM,
        expanded: 'A fixacao de carbono usa a enzima rubisco.',
      },
      'Carbono Fix (rubisco) = CO2 + ribulose',
    )
    expect(resultado).not.toBeNull()
    expect(resultado).toContain('A fixacao de carbono usa a enzima rubisco.')
    expect(resultado).not.toContain('Carbono Fix (rubisco)')
    // O resto da nota fica intacto.
    expect(resultado).toContain('Depois, mais texto.')
  })

  it('recusa quando a ancora nao bate mais', () => {
    // O rascunho mudou entre a proposta e o clique: o texto no intervalo
    // ja nao e o trecho que o provider ancorou. Gravar assim escreveria a
    // frase no lugar errado — apagando conteudo do aluno.
    const resultado = applyNoteExpansion(
      NOTA,
      {
        startUtf16: INICIO,
        endUtf16: FIM,
        expanded: 'A fixacao de carbono usa a enzima rubisco.',
      },
      'um trecho diferente',
    )
    expect(resultado).toBeNull()
  })

  it('recusa quando o intervalo esta fora do texto', () => {
    expect(
      applyNoteExpansion(NOTA, {
        startUtf16: NOTA.length + 10,
        endUtf16: NOTA.length + 20,
        expanded: 'frase',
      }),
    ).toBeNull()
  })

  it('recusa um intervalo invertido', () => {
    expect(
      applyNoteExpansion(NOTA, {
        startUtf16: 10,
        endUtf16: 5,
        expanded: 'frase',
      }),
    ).toBeNull()
  })

  it('recusa um intervalo vazio', () => {
    // Um trecho vazio nao e um trecho apressado: e um erro do provider.
    expect(
      applyNoteExpansion(NOTA, {
        startUtf16: 10,
        endUtf16: 10,
        expanded: 'frase',
      }),
    ).toBeNull()
  })

  it('aplica mesmo sem a ancora esperada', () => {
    // Sem a ancora nao ha como conferir, mas a faixa tem que ser valida.
    const resultado = applyNoteExpansion(NOTA, {
      startUtf16: INICIO,
      endUtf16: FIM,
      expanded: 'A frase completa.',
    })
    expect(resultado).toContain('A frase completa.')
  })
})
