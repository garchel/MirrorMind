/** Helpers puros dos blocos de plugins do Obsidian (Dataview, Tasks) renderizados
 * SOMENTE LEITURA: nunca executam a sintaxe do plugin nem alteram a fonte.
 * `dataviewjs` nunca e avaliado (codigo de plugin nao confiavel). */

export type PluginBlockLanguage = 'dataview' | 'dataviewjs' | 'tasks'

/** Linguagens de blocos de plugins reconhecidas na renderizacao. */
export const PLUGIN_BLOCK_LANGUAGES: readonly string[] = ['dataview', 'dataviewjs', 'tasks']

/** Normaliza a linguagem de um bloco de codigo para uma linguagem de plugin
 * conhecida, ou null para blocos normais. */
export function normalizePluginLanguage(language: string | null | undefined): PluginBlockLanguage | null {
  if (language === 'dataview' || language === 'dataviewjs' || language === 'tasks') return language
  return null
}

export type PluginBlock = {
  language: PluginBlockLanguage
  source: string
  /** Linhas de tarefa (`- [ ]` / `- [x]`) para o bloco tasks. */
  taskLines: Array<{ checked: boolean; text: string }>
}

/** Analisa o conteudo cru de um bloco de plugin (o texto entre as cercas). */
export function parsePluginBlock(language: PluginBlockLanguage, source: string): PluginBlock {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const taskLines = lines
    .map((line) => line.match(/^\s*-\s+\[( |x|X)\]\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({ checked: match[1] !== ' ', text: match[2] ?? '' }))
  return { language, source, taskLines }
}
