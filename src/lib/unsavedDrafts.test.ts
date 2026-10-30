import { describe, expect, it } from 'vitest'
import { NEW_NOTE_DRAFT_PATH, hasUnsavedNewNote, unsavedDraftPaths } from './unsavedDrafts'

const base = { 'notas/a.md': 'texto salvo', 'notas/b.md': 'outro texto' }

describe('unsavedDraftPaths', () => {
  it('nao acusa nada quando os rascunhos sao iguais ao disco', () => {
    expect(unsavedDraftPaths({
      activePath: 'notas/a.md',
      activeContent: 'texto salvo',
      draftsByPath: base,
      baseByPath: base,
    })).toEqual([])
  })

  it('acusa a nota ativa alterada e a poe primeiro', () => {
    expect(unsavedDraftPaths({
      activePath: 'notas/b.md',
      activeContent: 'texto novo',
      draftsByPath: { ...base, 'notas/b.md': 'texto novo' },
      baseByPath: base,
    })).toEqual(['notas/b.md'])
  })

  it('acusa rascunho de aba em segundo plano', () => {
    expect(unsavedDraftPaths({
      activePath: 'notas/b.md',
      activeContent: 'outro texto',
      draftsByPath: { ...base, 'notas/a.md': 'alterado fora da aba' },
      baseByPath: base,
    })).toEqual(['notas/a.md'])
  })

  it('nao pergunta nada quando a edicao foi desfeita', () => {
    // Rascunho voltou ao conteudo do disco: nao ha o que perder.
    expect(unsavedDraftPaths({
      activePath: 'notas/a.md',
      activeContent: 'texto salvo',
      draftsByPath: { ...base, 'notas/a.md': 'texto salvo' },
      baseByPath: base,
    })).toEqual([])
  })

  it('ignora caminho sem base conhecida', () => {
    expect(unsavedDraftPaths({
      activePath: null,
      activeContent: '',
      draftsByPath: { 'notas/c.md': 'sem base' },
      baseByPath: base,
    })).toEqual([])
  })

  it('nunca trata a aba de nota nova como nota do vault', () => {
    expect(unsavedDraftPaths({
      activePath: NEW_NOTE_DRAFT_PATH,
      activeContent: 'rascunho novo',
      draftsByPath: { [NEW_NOTE_DRAFT_PATH]: 'rascunho novo' },
      baseByPath: { [NEW_NOTE_DRAFT_PATH]: '' },
    })).toEqual([])
  })
})

describe('hasUnsavedNewNote', () => {
  it('nota nova com texto tem o que perder', () => {
    expect(hasUnsavedNewNote({ isNewNoteDraft: true, activeContent: 'ideia' })).toBe(true)
  })

  it('nota nova em branco nao pede confirmacao', () => {
    expect(hasUnsavedNewNote({ isNewNoteDraft: true, activeContent: '   \n' })).toBe(false)
  })

  it('nota salva nao conta como nota nova', () => {
    expect(hasUnsavedNewNote({ isNewNoteDraft: false, activeContent: 'ideia' })).toBe(false)
  })
})
