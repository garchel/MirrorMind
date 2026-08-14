import { describe, expect, it } from 'vitest'
import { normalizePluginLanguage, parsePluginBlock } from './pluginBlocks'

describe('normalizePluginLanguage', () => {
  it('reconhece dataview, dataviewjs e tasks; blocos normais sao null', () => {
    expect(normalizePluginLanguage('dataview')).toBe('dataview')
    expect(normalizePluginLanguage('dataviewjs')).toBe('dataviewjs')
    expect(normalizePluginLanguage('tasks')).toBe('tasks')
    expect(normalizePluginLanguage('javascript')).toBe(null)
    expect(normalizePluginLanguage(null)).toBe(null)
  })
})

describe('parsePluginBlock', () => {
  it('extrai linhas de tarefa marcadas do bloco tasks', () => {
    const block = parsePluginBlock('tasks', '- [ ] Estudar quimica\n- [x] Ler o capitulo\nTexto solto')
    expect(block.taskLines).toEqual([
      { checked: false, text: 'Estudar quimica' },
      { checked: true, text: 'Ler o capitulo' },
    ])
    expect(block.source).toContain('Texto solto')
  })

  it('nao cria linhas de tarefa sem marcador', () => {
    const block = parsePluginBlock('tasks', 'apenas texto')
    expect(block.taskLines).toEqual([])
  })

  it('preserva a fonte crua dos blocos dataview', () => {
    const block = parsePluginBlock('dataview', 'TABLE titulo FROM #estudo')
    expect(block.source).toBe('TABLE titulo FROM #estudo')
    expect(block.taskLines).toEqual([])
  })
})
