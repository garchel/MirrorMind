import { describe, expect, it } from 'vitest'
import {
  clampFontSize,
  clampHistoryLimit,
  DEFAULT_FONT_SIZE,
  effectiveThemeMode,
  fontFamilyCss,
  normalizeAccentColor,
  normalizeFontFamily,
  normalizeThemeMode,
  obsidianThemeToMode,
} from './appearance'

describe('normalizeThemeMode', () => {
  it('aceita os modos conhecidos e cai para claro no resto', () => {
    expect(normalizeThemeMode('light')).toBe('light')
    expect(normalizeThemeMode('dark')).toBe('dark')
    expect(normalizeThemeMode('follow-obsidian')).toBe('follow-obsidian')
    expect(normalizeThemeMode('neon')).toBe('light')
    expect(normalizeThemeMode(null)).toBe('light')
  })
})

describe('obsidianThemeToMode', () => {
  it('traduz o campo theme do Obsidian', () => {
    expect(obsidianThemeToMode('obsidian')).toBe('dark')
    expect(obsidianThemeToMode('moonstone')).toBe('light')
    expect(obsidianThemeToMode(null)).toBe('light')
  })
})

describe('effectiveThemeMode', () => {
  it('resolve follow-obsidian contra a aparencia do Vault', () => {
    expect(effectiveThemeMode('dark', null)).toBe('dark')
    expect(effectiveThemeMode('light', null)).toBe('light')
    expect(effectiveThemeMode('follow-obsidian', { theme: 'obsidian', ignoredAppearanceFields: [] })).toBe('dark')
    expect(effectiveThemeMode('follow-obsidian', { theme: 'moonstone', ignoredAppearanceFields: [] })).toBe('light')
    expect(effectiveThemeMode('follow-obsidian', null)).toBe('light')
  })
})

describe('font helpers', () => {
  it('normaliza familia, clamp de tamanho e CSS resultante', () => {
    expect(normalizeFontFamily('serif')).toBe('serif')
    expect(normalizeFontFamily('mono')).toBe('mono')
    expect(normalizeFontFamily('script')).toBe('sans')
    expect(clampFontSize(18)).toBe(18)
    expect(clampFontSize(50)).toBe(24)
    expect(clampFontSize(8)).toBe(12)
    expect(clampFontSize(null)).toBe(DEFAULT_FONT_SIZE)
    expect(fontFamilyCss('serif')).toContain('Georgia')
    expect(fontFamilyCss('mono')).toBe('var(--mono)')
    expect(fontFamilyCss('sans')).toBe('var(--sans)')
  })
})

describe('clampHistoryLimit', () => {
  it('clamp dentro dos limites e usa o padrao para valores invalidos', () => {
    expect(clampHistoryLimit(200)).toBe(200)
    expect(clampHistoryLimit(10000)).toBe(500)
    expect(clampHistoryLimit(2)).toBe(10)
    expect(clampHistoryLimit(undefined)).toBe(100)
  })
})

describe('normalizeAccentColor', () => {
  it('normaliza hexadecimal com ou sem # e rejeita valores invalidos', () => {
    expect(normalizeAccentColor('#c46a2b')).toBe('#c46a2b')
    expect(normalizeAccentColor('c46a2b')).toBe('#c46a2b')
    expect(normalizeAccentColor('red')).toBe(null)
    expect(normalizeAccentColor(null)).toBe(null)
  })
})
