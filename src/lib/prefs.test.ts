import { describe, expect, it, beforeEach } from 'vitest'
import { readPref, writePref, parseBoolean, parseNumber, parseNonEmptyString, parseJson, serializeBoolean, serializeJson } from './prefs'

const KEY = 'mirrormind.test.pref'

describe('camada de preferências (prefs.ts)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('devolve o fallback quando a chave não existe', () => {
    expect(readPref(KEY, true, parseBoolean)).toBe(true)
    expect(readPref(`${KEY}.n`, 7, parseNumber([0, 100]))).toBe(7)
  })

  it('grava e relê com parse/serialize', () => {
    writePref(KEY, false, serializeBoolean)
    expect(readPref(KEY, true, parseBoolean)).toBe(false)
  })

  it('valor corrompido nunca quebra: fallback silencioso', () => {
    localStorage.setItem(KEY, 'não é boolean')
    expect(readPref(KEY, true, parseBoolean)).toBe(true)
    localStorage.setItem(`${KEY}.n`, 'NaN!!')
    expect(readPref(`${KEY}.n`, 42, parseNumber([0, 100]))).toBe(42)
  })

  it('clamp de números fora do intervalo', () => {
    localStorage.setItem(`${KEY}.n`, '9999')
    expect(readPref(`${KEY}.n`, 10, parseNumber([0, 100]))).toBe(100)
    localStorage.setItem(`${KEY}.n`, '-50')
    expect(readPref(`${KEY}.n`, 10, parseNumber([0, 100]))).toBe(0)
  })

  it('string vazia cai no fallback', () => {
    localStorage.setItem(`${KEY}.s`, '')
    expect(readPref(`${KEY}.s`, 'padrao', parseNonEmptyString)).toBe('padrao')
  })

  it('json inválido cai no fallback', () => {
    localStorage.setItem(`${KEY}.j`, '{nope')
    expect(readPref<{ a: number }>(`${KEY}.j`, { a: 1 }, parseJson)).toEqual({ a: 1 })
    writePref(`${KEY}.j`, { a: 5 }, serializeJson)
    expect(readPref(`${KEY}.j`, { a: 1 }, parseJson)).toEqual({ a: 5 })
  })

  it('escopo por vault isola chaves com mesmo id', () => {
    writePref(KEY, true, serializeBoolean, 'C:/vault-a')
    writePref(KEY, false, serializeBoolean, 'C:/vault-b')
    expect(readPref(KEY, null, parseBoolean, 'C:/vault-a')).toBe(true)
    expect(readPref(KEY, null, parseBoolean, 'C:/vault-b')).toBe(false)
    // Sem escopo continua lendo a chave crua original (compatibilidade).
    expect(readPref(KEY, false, parseBoolean)).toBe(false)
  })

  it('chaves legadas sem escopo continuam legíveis (mesma string)', () => {
    localStorage.setItem('mirrormind.legacy-key', 'true')
    expect(readPref('mirrormind.legacy-key', false, parseBoolean)).toBe(true)
  })
})
