/** Helpers puros das preferencias de aparencia: modo de tema (claro/escuro/
 * seguir Obsidian), importacao segura de `appearance.json` (nunca sobrescrito)
 * e validacao de fonte/tamanho. Tanto a pagina de Configuracoes quanto o
 * aplicador de tema consomem estas funcoes. */
import type { ObsidianAppearance } from './vault'

export type ThemeMode = 'light' | 'dark' | 'follow-obsidian'

export type EditorFontFamily = 'sans' | 'serif' | 'mono'

export const THEME_MODES: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
  { value: 'follow-obsidian', label: 'Seguir Obsidian' },
]

export const FONT_FAMILIES: ReadonlyArray<{ value: EditorFontFamily; label: string }> = [
  { value: 'sans', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monoespacada' },
]

export const DEFAULT_FONT_SIZE = 16
export const MIN_FONT_SIZE = 12
export const MAX_FONT_SIZE = 24

export const DEFAULT_HISTORY_LIMIT = 100
export const MIN_HISTORY_LIMIT = 10
export const MAX_HISTORY_LIMIT = 500

/** Normaliza um modo de tema salvo; valores desconhecidos caem para 'light'. */
export function normalizeThemeMode(value: string | null | undefined): ThemeMode {
  return value === 'dark' || value === 'follow-obsidian' ? value : 'light'
}

/** Traduz o campo `theme` do Obsidian: 'obsidian' = escuro, 'moonstone' =
 * claro; qualquer outro valor (ou ausencia) e tratado como claro. */
export function obsidianThemeToMode(theme: string | null | undefined): 'light' | 'dark' {
  return theme === 'obsidian' ? 'dark' : 'light'
}

/** Modo efetivo dado o modo escolhido e a aparencia do Vault: 'follow-obsidian'
 * resolve para a preferencia do `appearance.json` quando disponivel. */
export function effectiveThemeMode(mode: ThemeMode, obsidianAppearance: ObsidianAppearance | null): 'light' | 'dark' {
  if (mode === 'dark') return 'dark'
  if (mode === 'follow-obsidian') return obsidianThemeToMode(obsidianAppearance?.theme)
  return 'light'
}

/** Normaliza uma familia de fonte salva; valores desconhecidos caem para
 * 'sans' (a familia atual do app). */
export function normalizeFontFamily(value: string | null | undefined): EditorFontFamily {
  return value === 'serif' || value === 'mono' ? value : 'sans'
}

/** Clampa um tamanho de fonte (px) dentro dos limites suportados. */
export function clampFontSize(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return DEFAULT_FONT_SIZE
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
}

/** Clampa o limite do historico de desfazer/refazer. */
export function clampHistoryLimit(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return DEFAULT_HISTORY_LIMIT
  return Math.min(MAX_HISTORY_LIMIT, Math.max(MIN_HISTORY_LIMIT, Math.round(value)))
}

/** Familia CSS efetiva para o editor e a leitura. */
export function fontFamilyCss(family: EditorFontFamily): string {
  if (family === 'serif') return 'Georgia, "Times New Roman", serif'
  if (family === 'mono') return 'var(--mono)'
  return 'var(--sans)'
}

/** Acentos validos: hexadecimal #rrggbb. O acento do Obsidian pode chegar sem
 * '#', entao normalizamos antes de validar. */
export function normalizeAccentColor(value: string | null | undefined): string | null {
  if (!value) return null
  const withHash = value.startsWith('#') ? value : `#${value}`
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash : null
}
