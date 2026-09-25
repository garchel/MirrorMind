import { describe, expect, it } from 'vitest'
import {
  addNotePostit,
  deriveRangeAnchorFromSelection,
  getNotePostits,
  postitRangesOverlap,
  resolvePostitAnchors,
  resolvePostitRange,
  updateNotePostit,
  type NotePostit,
} from './postits'

const BODY = '# Titulo\n\nPrimeiro paragrafo com a frase alvo aqui.\n\nSegundo paragrafo com a frase alvo ali.\n'

function paragraphPostit(overrides: Partial<NotePostit> = {}): NotePostit {
  return {
    id: 'postit-1',
    anchorText: 'Primeiro paragrafo com a frase alvo aqui.',
    anchorOrdinal: 0,
    range: null,
    color: 'yellow',
    text: 'nota',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('postits por citacao (range)', () => {
  it('deriva ancora com ocorrencia deterministica entre repetidas', () => {
    const first = BODY.indexOf('frase alvo')
    const anchor = deriveRangeAnchorFromSelection(BODY, first, first + 'frase alvo'.length)
    expect(anchor).toMatchObject({ quote: 'frase alvo', occurrence: 0 })
    expect(anchor?.prefix).toContain('com a')
    // Contextos distintos desempatam sozinhos: a segunda tambem e 0 entre as
    // candidatas com o contexto dela.
    const second = BODY.indexOf('frase alvo', first + 1)
    expect(deriveRangeAnchorFromSelection(BODY, second, second + 'frase alvo'.length)).toMatchObject({ occurrence: 0 })
    // Contextos byte-identicos nos dois lados: o indice distingue a segunda.
    const pad = 'z '.repeat(40)
    const repeated = `${pad}frase alvo fim ${pad}frase alvo fim`
    const firstRepeated = repeated.indexOf('frase alvo')
    const secondRepeated = repeated.indexOf('frase alvo', firstRepeated + 1)
    expect(deriveRangeAnchorFromSelection(repeated, secondRepeated, secondRepeated + 'frase alvo'.length)).toMatchObject({ occurrence: 1 })
    expect(resolvePostitRange(
      deriveRangeAnchorFromSelection(repeated, secondRepeated, secondRepeated + 'frase alvo'.length)!,
      repeated,
    )).toEqual({ from: secondRepeated, to: secondRepeated + 'frase alvo'.length })
  })

  it('rejeita selecao vazia, invertida e citacao gigante', () => {
    expect(deriveRangeAnchorFromSelection(BODY, 5, 5)).toBeNull()
    expect(deriveRangeAnchorFromSelection(BODY, 10, 5)).toBeNull()
    const longBody = `texto ${'x'.repeat(600)} fim`
    expect(deriveRangeAnchorFromSelection(longBody, 0, longBody.length)).toBeNull()
  })

  it('resolve pela ocorrencia com contexto', () => {
    const second = BODY.indexOf('frase alvo', BODY.indexOf('frase alvo') + 1)
    const resolved = resolvePostitRange(
      { quote: 'frase alvo', prefix: 'com a', suffix: 'ali', occurrence: 0 },
      BODY,
    )
    expect(resolved).toEqual({ from: second, to: second + 'frase alvo'.length })
  })

  it('casa espacos flexiveis mantendo offsets verdadeiros', () => {
    const body = 'Texto com   varias\nquebras aqui.'
    const resolved = resolvePostitRange({ quote: 'varias quebras', prefix: '', suffix: '', occurrence: 0 }, body)
    expect(resolved).not.toBeNull()
    expect(body.slice(resolved!.from, resolved!.to).replace(/\s+/g, ' ')).toBe('varias quebras')
  })

  it('ocorrencia fora da faixa e citacao ausente viram null', () => {
    expect(resolvePostitRange({ quote: 'frase alvo', prefix: '', suffix: '', occurrence: 9 }, BODY)).toBeNull()
    expect(resolvePostitRange({ quote: 'inexistente', prefix: '', suffix: '', occurrence: 0 }, BODY)).toBeNull()
  })

  it('sobreposicao exige intersecao real (encostar e permitido)', () => {
    expect(postitRangesOverlap({ from: 0, to: 5 }, { from: 3, to: 8 })).toBe(true)
    expect(postitRangesOverlap({ from: 0, to: 5 }, { from: 5, to: 8 })).toBe(false)
    expect(postitRangesOverlap({ from: 0, to: 5 }, { from: 8, to: 10 })).toBe(false)
  })

  it('resolvePostitAnchors devolve a faixa junto do paragrafo', () => {
    const from = BODY.indexOf('frase alvo')
    const postit = paragraphPostit({
      range: { quote: 'frase alvo', prefix: 'com a', suffix: 'aqui', occurrence: 0 },
    })
    const [resolved] = resolvePostitAnchors([postit], BODY, 0)
    expect(resolved.from).not.toBeNull()
    expect(resolved.range).toEqual({ from, to: from + 'frase alvo'.length })
  })

  it('faixa quebrada cai para o paragrafo (pino preservado)', () => {
    const postit = paragraphPostit({
      range: { quote: 'sumiu do texto', prefix: '', suffix: '', occurrence: 0 },
    })
    const [resolved] = resolvePostitAnchors([postit], BODY, 0)
    expect(resolved.from).not.toBeNull()
    expect(resolved.range).toBeNull()
  })

  it('serializa a ancora de frase e le de volta (retrocompat sem range)', () => {
    const created = addNotePostit('# N\n\nTexto com alvo aqui.\n', {
      anchorText: 'Texto com alvo aqui.',
      color: 'blue',
      text: 'nota',
      range: { quote: 'alvo', prefix: 'com', suffix: 'aqui', occurrence: 0 },
    })
    expect(created.error).toBeNull()
    const [loaded] = getNotePostits(created.content)
    expect(loaded.range).toEqual({ quote: 'alvo', prefix: 'com', suffix: 'aqui', occurrence: 0 })

    const legacy = addNotePostit('# N\n\nTexto.\n', { anchorText: 'Texto.', color: 'pink', text: 'nota' })
    const [legacyLoaded] = getNotePostits(legacy.content)
    expect(legacyLoaded.range).toBeNull()
    expect(legacy.content).not.toContain('range')
  })

  it('aceita as cores novas (roxo/vermelho) e normaliza invalida para amarelo', () => {
    const created = addNotePostit('# N\n\nTexto com alvo aqui.\n', {
      anchorText: 'Texto com alvo aqui.',
      color: 'purple',
      text: 'nota',
      range: { quote: 'alvo', prefix: 'com', suffix: 'aqui', occurrence: 0 },
    })
    const [loaded] = getNotePostits(created.content)
    expect(loaded.color).toBe('purple')
    const tampered = created.content.replace('color: purple', 'color: ultraviolet')
    expect(getNotePostits(tampered)[0].color).toBe('yellow')
  })

  it('update troca a area e null limpa para paragrafo', () => {
    const created = addNotePostit('# N\n\nTexto com alvo aqui.\n', {
      anchorText: 'Texto com alvo aqui.',
      color: 'green',
      text: 'nota',
      range: { quote: 'alvo', prefix: 'com', suffix: 'aqui', occurrence: 0 },
    })
    const [postit] = getNotePostits(created.content)
    const moved = updateNotePostit(created.content, postit.id, {
      range: { quote: 'Texto', prefix: '', suffix: '', occurrence: 0 },
    })
    expect(getNotePostits(moved.content)[0].range?.quote).toBe('Texto')
    const cleared = updateNotePostit(moved.content, postit.id, { range: null })
    expect(getNotePostits(cleared.content)[0].range).toBeNull()
  })
  it('range invalido no YAML degrada para paragrafo sem descartar', () => {
    const created = addNotePostit('# N\n\nTexto.\n', { anchorText: 'Texto.', color: 'yellow', text: 'nota' })
    const tampered = created.content.replace('anchorOrdinal: 0', 'anchorOrdinal: 0\n    range:\n      quote: ""\n      occurrence: -1')
    const [loaded] = getNotePostits(tampered)
    expect(loaded.range).toBeNull()
    expect(loaded.id).toBeTruthy()
  })

  it('marca-texto no meio da citacao nao quebra a resolucao (offsets crus)', () => {
    // Post-it criado antes do highlight; depois o usuario marca "alvo".
    const body = 'Frase <mark class="hl-blue">alvo</mark> aqui.'
    const resolved = resolvePostitRange({ quote: 'Frase alvo', prefix: '', suffix: '', occurrence: 0 }, body)
    expect(resolved).not.toBeNull()
    expect(body.slice(resolved!.from, resolved!.to)).toBe('Frase <mark class="hl-blue">alvo</mark>')
  })

  it('derivacao atraves de tags salva citacao limpa', () => {
    const body = 'Frase <mark class="hl-blue">alvo</mark> aqui.'
    const anchor = deriveRangeAnchorFromSelection(body, 0, body.indexOf('aqui.'))
    expect(anchor).not.toBeNull()
    expect(anchor!.quote).toBe('Frase alvo')
    expect(anchor!.quote).not.toContain('<')
    // E resolve de volta para os offsets crus (cobrindo as tags).
    expect(resolvePostitRange(anchor!, body)).toEqual({ from: 0, to: body.indexOf(' aqui.') })
  })

  it('citacao antiga com tags cruas migra silenciosamente', () => {
    const body = 'Frase alvo aqui.'
    const resolved = resolvePostitRange(
      { quote: 'Frase <mark class="hl-blue">alvo</mark>', prefix: '', suffix: '', occurrence: 0 },
      body,
    )
    expect(resolved).toEqual({ from: 0, to: 'Frase alvo'.length })
  })

  it('texto com "<" literal nao e comido pelo strip', () => {
    const body = 'a < b e <mark>c</mark> d'
    const resolved = resolvePostitRange({ quote: 'a < b', prefix: '', suffix: '', occurrence: 0 }, body)
    expect(resolved).toEqual({ from: 0, to: 'a < b'.length })
  })
})
