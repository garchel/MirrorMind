import { describe, expect, it } from 'vitest'
import {
  indexDictionary,
  normalizeTerm,
  wordAt,
  type DictionaryEntry,
} from './dictionarySchema'
import { documentWords, termPositions } from './dictionaryExtension'

function entry(term: string, concept = 'conceito'): DictionaryEntry {
  return { term, concept, createdAtUnixMs: 0, updatedAtUnixMs: 0 }
}

describe('normalizeTerm', () => {
  it('ignora caixa e acentos, como o backend', () => {
    expect(normalizeTerm('Glicólise')).toBe('glicolise')
    expect(normalizeTerm('RUBISCO')).toBe('rubisco')
  })

  it('tira a pontuacao das pontas', () => {
    expect(normalizeTerm('  Rubisco.  ')).toBe('rubisco')
  })

  it('preserva o espaco interno, porque o termo pode ter varias palavras', () => {
    expect(normalizeTerm('pH ótimo')).toBe('ph otimo')
  })

  it('devolve vazio para um texto sem letras nem numeros', () => {
    expect(normalizeTerm('---')).toBe('')
    expect(normalizeTerm('   ')).toBe('')
  })
})

describe('indexDictionary', () => {
  it('indexa por termo normalizado', () => {
    const index = indexDictionary([entry('Glicólise')])
    expect(index.get('glicolise')?.term).toBe('Glicólise')
  })

  it('ignora os termos vazios', () => {
    const index = indexDictionary([entry('---')])
    expect(index.size).toBe(0)
  })
})

describe('wordAt', () => {
  it('acha a palavra sob a posicao', () => {
    const text = 'a glicolise aeróbica ocorre'
    const found = wordAt(text, 4)
    expect(found?.word).toBe('glicolise')
    expect(text.slice(found!.start, found!.end)).toBe('glicolise')
  })

  it('devolve nulo sobre um espaco', () => {
    expect(wordAt('a glicolise', 1)).toBeNull()
  })

  it('devolve nulo fora do texto', () => {
    expect(wordAt('curto', 99)).toBeNull()
  })

  it('acha a palavra com acento', () => {
    const text = 'a glicólise ocorre'
    const found = wordAt(text, 3)
    expect(found?.word).toBe('glicólise')
  })
})

describe('documentWords', () => {
  it('extrai as palavras com as posicoes', () => {
    const words = documentWords('a glicolise aeróbica')
    expect(words.map((word) => word.normalized)).toEqual(['a', 'glicolise', 'aerobica'])
    expect(words[1].from).toBe(2)
    expect(words[1].to).toBe(11)
  })

  it('ignora a pontuacao', () => {
    const words = documentWords('um, dois. tres!')
    expect(words.map((word) => word.normalized)).toEqual(['um', 'dois', 'tres'])
  })

  it('devolve lista vazia para um texto sem palavras', () => {
    expect(documentWords('... !!!')).toEqual([])
  })
})

describe('termPositions', () => {
  it('acha um termo de uma palavra', () => {
    const words = documentWords('o rubisco fixa o carbono')
    const positions = termPositions(words, 'rubisco')
    expect(positions).toHaveLength(1)
    expect(positions[0].from).toBe(2)
  })

  it('acha um termo de varias palavras', () => {
    const words = documentWords('a glicolise aeróbica ocorre aqui')
    const positions = termPositions(words, 'glicólise aeróbica')
    expect(positions).toHaveLength(1)
  })

  it('ignora a diferenca de caixa e acento', () => {
    const words = documentWords('a Glicólise Aeróbica ocorre')
    expect(termPositions(words, 'glicolise aerobica')).toHaveLength(1)
  })

  it('NÃO casa o termo dentro de outra palavra', () => {
    // "arte" dentro de "partido" nao e o termo.
    const words = documentWords('um partido no court')
    expect(termPositions(words, 'arte')).toHaveLength(0)
  })

  it('NÃO casa o termo dentro de outra palavra maior', () => {
    const words = documentWords('o partnership')
    expect(termPositions(words, 'art')).toHaveLength(0)
  })

  it('encontra todas as ocorrencias', () => {
    const words = documentWords('rubisco e rubisco de novo')
    expect(termPositions(words, 'rubisco')).toHaveLength(2)
  })

  it('devolve lista vazia para um termo vazio', () => {
    const words = documentWords('qualquer coisa')
    expect(termPositions(words, '---')).toHaveLength(0)
  })
})
