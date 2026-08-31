import { describe, expect, it } from 'vitest'
import { BUILDER_FRIENDLY_NAMES, UI_STRUCTURE } from './ui-structure'

describe('Estrutura de UI e nomes amigaveis', () => {
  it('nomeia a janela do editor (busca Ctrl+F e popover de seleção)', () => {
    // O popover de formatacao e a busca Ctrl+F vivem no mesmo contêiner; ele
    // precisa ter nome amigavel para o modo Builder e chave na estrutura.
    expect(UI_STRUCTURE.workspace.editorContent).toBe('editor-content')
    expect(BUILDER_FRIENDLY_NAMES['editor-content']).toBe('Editor da nota')
  })

  it('nomeia o cabeçalho da nota (título, avaliação, modo de visualização e tags)', () => {
    expect(UI_STRUCTURE.workspace.noteHeader).toBe('editor-header')
    expect(BUILDER_FRIENDLY_NAMES['editor-header']).toBe('Cabeçalho da nota')
  })
})
