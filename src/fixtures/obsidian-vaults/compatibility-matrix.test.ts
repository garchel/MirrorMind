import { describe, expect, it } from 'vitest'
import studyNote from './study-vault/Notas/Quimica.md?raw'
import projectNote from './project-vault/Projetos/Roadmap.md?raw'
import dailyNote from './project-vault/Diarias/2026-07-14.md?raw'
import {
  getMarkdownBody,
  getMarkdownFrontmatterProperties,
  replaceMarkdownBody,
} from '../../lib/markdown'

describe('Obsidian vault compatibility matrix', () => {
  it.each([
    ['study vault', studyNote, ['estudo/quimica', 'revisao']],
    ['project vault', projectNote, undefined],
  ])('parses nested properties from the %s fixture', (_name, note, expectedTags) => {
    const properties = getMarkdownFrontmatterProperties(note)

    expect(properties).toBeTruthy()
    if (expectedTags) expect(properties?.tags).toEqual(expectedTags)
  })

  it('parses nested project properties without flattening lists or objects', () => {
    expect(getMarkdownFrontmatterProperties(projectNote)).toMatchObject({
      status: 'active',
      owners: ['Ana', 'Paulo'],
      milestones: {
        v1: {
          due: '2026-09-01',
          features: ['editor', 'revisao'],
        },
      },
    })
  })

  it('preserves advanced YAML and unsupported blocks while editing the body', () => {
    const edited = replaceMarkdownBody(
      studyNote,
      `${getMarkdownBody(studyNote)}\n\nNova observacao de revisao.`,
    )

    expect(edited).toContain('# Propriedades que devem sobreviver a qualquer edicao')
    expect(edited).toContain('plugin-field: { color: "yellow", pinned: true }')
    expect(edited).toContain('<study-plugin data-id="chem-01">preservar este bloco</study-plugin>')
    expect(edited).toContain('Nova observacao de revisao.')
  })

  it.each([
    ['study vault note', studyNote],
    ['project vault note', projectNote],
    ['project daily note', dailyNote],
  ])('round-trips the exact %s source around a body edit', (_name, note) => {
    const originalBody = getMarkdownBody(note)
    const editedBody = `${originalBody}\n\nRegression edit.`

    const edited = replaceMarkdownBody(note, editedBody)

    expect(edited).toBe(note.replace(originalBody, editedBody))
    expect(getMarkdownBody(edited)).toBe(editedBody)
  })

  it('keeps daily-note links with block references intact', () => {
    expect(dailyNote).toContain('[[Projetos/Roadmap#^decisao-v1|roadmap]]')
  })
})
