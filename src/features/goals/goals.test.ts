import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  buildIndexNoteContent,
  buildStepNoteContent,
  createGoalStepNote,
  goalIndexRelativePath,
  goalSlug,
  isStepDone,
  type Goal,
} from './goals'

const goal: Goal = {
  id: 'goal-1',
  title: 'Aprender fotossíntese',
  objective: 'Explicar sem consultar',
  sourceText: '',
  createdAtUnixMs: 1_700_000_000_000,
  steps: [
    {
      order: 1,
      title: 'Fundamentos',
      summary: 'Base mínima.',
      suggestedRelativePath: 'Metas/aprender-fotossintese/01-fundamentos.md',
    },
    {
      order: 2,
      title: 'Prática guiada',
      summary: 'Exercícios.',
      suggestedRelativePath: 'Metas/aprender-fotossintese/02-pratica-guiada.md',
    },
  ],
  aiGenerated: false,
  noteContentMode: 'blank' as const,
}

describe('goalSlug', () => {
  it('espelha o slugify do backend', () => {
    expect(goalSlug('Aprender fotossíntese')).toBe('aprender-fotossintese')
    expect(goalSlug('Hello, World!')).toBe('hello-world')
    expect(goalSlug('  --oi--  ')).toBe('oi')
    expect(goalSlug('???')).toBe('meta')
    expect(goalSlug('a'.repeat(100)).length).toBeLessThanOrEqual(48)
  })
})

describe('goalIndexRelativePath', () => {
  it('usa a pasta do backend e o nome da meta com prefixo 00-', () => {
    expect(goalIndexRelativePath(goal)).toBe('Metas/aprender-fotossintese/00-aprender-fotossintese.md')
  })
})

describe('isStepDone', () => {
  it('deriva a conclusão da nota vinculada', () => {
    expect(isStepDone({ noteRelativePath: 'Metas/x/01-a.md' })).toBe(true)
    expect(isStepDone({ noteRelativePath: null })).toBe(false)
    expect(isStepDone({})).toBe(false)
  })
})

describe('buildIndexNoteContent', () => {
  it('gera checklist em ordem com links e checks das criadas', () => {
    const content = buildIndexNoteContent({
      goalTitle: goal.title,
      objective: goal.objective,
      steps: [{ ...goal.steps[0], noteRelativePath: goal.steps[0].suggestedRelativePath }, goal.steps[1]],
    })
    expect(content).toContain('# Aprender fotossíntese')
    expect(content).toContain('- [x] [[Metas/aprender-fotossintese/01-fundamentos.md|Fundamentos]]')
    expect(content).toContain('- [ ] [[Metas/aprender-fotossintese/02-pratica-guiada.md|Prática guiada]]')
  })
})

describe('buildStepNoteContent', () => {
  it('linka de volta para a indexadora', () => {
    const content = buildStepNoteContent({
      goalTitle: goal.title,
      goalSlug: goalSlug(goal.title),
      indexPath: 'Metas/aprender-fotossintese/00-aprender-fotossintese.md',
      order: 1,
      title: 'Fundamentos',
      summary: 'Base mínima.',
    })
    expect(content).toContain('# Fundamentos')
    expect(content).toContain('[[Metas/aprender-fotossintese/00-aprender-fotossintese.md|Aprender fotossíntese]]')
    expect(content).toContain('tags: [meta/aprender-fotossintese]')
    expect(content).toContain('## Dúvidas')
  })

  it('monta frontmatter e seções do draft da IA', () => {
    const content = buildStepNoteContent({
      goalTitle: goal.title,
      goalSlug: goalSlug(goal.title),
      indexPath: 'Metas/aprender-fotossintese/00-aprender-fotossintese.md',
      order: 1,
      title: 'Fundamentos',
      summary: 'Base mínima.',
      draft: {
        tags: ['fotossintese'],
        sections: [{ heading: 'Perguntas-guia', body: 'Pergunte-se: o que é?' }],
      },
    })
    expect(content).toContain('tags: [meta/aprender-fotossintese, fotossintese]')
    expect(content).toContain('## Perguntas-guia')
    expect(content).toContain('Pergunte-se: o que é?')
  })
})

describe('createGoalStepNote', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('cria passo + indexadora, vincula e devolve os caminhos', async () => {
    const updated: Goal = {
      ...goal,
      steps: [{ ...goal.steps[0], noteRelativePath: goal.steps[0].suggestedRelativePath }, goal.steps[1]],
    }
    invoke.mockImplementation((command: string) => {
      if (command === 'update_goal_step_command') return Promise.resolve(updated)
      return Promise.resolve({})
    })
    const result = await createGoalStepNote({ vaultPath: 'C:\\Vault', goal, order: 1 })
    expect(result.notePath).toBe('Metas/aprender-fotossintese/01-fundamentos.md')
    expect(result.indexPath).toBe('Metas/aprender-fotossintese/00-aprender-fotossintese.md')
    expect(result.goal).toEqual(updated)
    const commands = invoke.mock.calls.map(([command]) => command)
    expect(commands).toEqual(['create_note', 'save_note', 'update_goal_step_command', 'create_note', 'save_note'])
    // A indexadora é regravada com o check do passo criado.
    const indexSave = invoke.mock.calls.find(([command, args]) => command === 'save_note' && (args as { relativePath: string }).relativePath.endsWith('00-aprender-fotossintese.md'))
    if (!indexSave) throw new Error('a indexadora não foi regravada')
    expect((indexSave[1] as { content: string }).content).toContain('- [x] [[Metas/aprender-fotossintese/01-fundamentos.md|Fundamentos]]')
  })

  it('rejeita passo inexistente sem tocar no IPC', async () => {
    await expect(createGoalStepNote({ vaultPath: 'C:\\Vault', goal, order: 99 })).rejects.toThrow()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('monta frontmatter e seções do draft no modo IA', async () => {
    const updated: Goal = {
      ...goal,
      steps: [{ ...goal.steps[0], noteRelativePath: goal.steps[0].suggestedRelativePath }, goal.steps[1]],
    }
    invoke.mockImplementation((command: string) => {
      if (command === 'generate_goal_step_draft_command') {
        return Promise.resolve({
          tags: ['fotossintese', 'clorofila'],
          sections: [{ heading: 'Perguntas-guia', body: 'Pergunte-se: o que é fotossíntese?' }],
        })
      }
      if (command === 'update_goal_step_command') return Promise.resolve(updated)
      return Promise.resolve({})
    })
    const result = await createGoalStepNote({
      vaultPath: 'C:\\Vault',
      goal: { ...goal, noteContentMode: 'ai' },
      order: 1,
      provider: 'ollama',
    })
    expect(result.usedAiDraft).toBe(true)
    expect(result.draftError).toBeNull()
    const stepSave = invoke.mock.calls.find(([command, args]) =>
      command === 'save_note' && (args as { relativePath: string }).relativePath.endsWith('01-fundamentos.md'),
    )
    if (!stepSave) throw new Error('a nota do passo não foi gravada')
    const content = (stepSave[1] as { content: string }).content
    expect(content).toContain('tags: [meta/aprender-fotossintese, fotossintese, clorofila]')
    expect(content).toContain('meta: "Aprender fotossíntese"')
    expect(content).toContain('## Perguntas-guia')
    expect(content).toContain('[[Metas/aprender-fotossintese/00-aprender-fotossintese.md|Aprender fotossíntese]]')
  })

  it('cai para em branco quando a IA falha, com o motivo', async () => {
    const updated: Goal = {
      ...goal,
      steps: [{ ...goal.steps[0], noteRelativePath: goal.steps[0].suggestedRelativePath }, goal.steps[1]],
    }
    invoke.mockImplementation((command: string) => {
      if (command === 'generate_goal_step_draft_command') {
        return Promise.reject(new Error('Orçamento mensal de IA atingido'))
      }
      if (command === 'update_goal_step_command') return Promise.resolve(updated)
      return Promise.resolve({})
    })
    const result = await createGoalStepNote({
      vaultPath: 'C:\\Vault',
      goal: { ...goal, noteContentMode: 'ai' },
      order: 1,
      provider: 'ollama',
    })
    expect(result.usedAiDraft).toBe(false)
    expect(result.draftError).toContain('Orçamento mensal')
    const stepSave = invoke.mock.calls.find(([command, args]) =>
      command === 'save_note' && (args as { relativePath: string }).relativePath.endsWith('01-fundamentos.md'),
    )
    if (!stepSave) throw new Error('a nota do passo não foi gravada')
    const content = (stepSave[1] as { content: string }).content
    expect(content).toContain('## O que estudar')
    expect(content).not.toContain('## Perguntas-guia')
  })

  it('não chama a IA sem provedor e avisa o motivo', async () => {
    const updated: Goal = {
      ...goal,
      steps: [{ ...goal.steps[0], noteRelativePath: goal.steps[0].suggestedRelativePath }, goal.steps[1]],
    }
    invoke.mockImplementation((command: string) => {
      if (command === 'update_goal_step_command') return Promise.resolve(updated)
      return Promise.resolve({})
    })
    const result = await createGoalStepNote({
      vaultPath: 'C:\\Vault',
      goal: { ...goal, noteContentMode: 'ai' },
      order: 1,
      provider: null,
    })
    expect(result.usedAiDraft).toBe(false)
    expect(result.draftError).toContain('Nenhum provedor')
    expect(invoke.mock.calls.some(([command]) => command === 'generate_goal_step_draft_command')).toBe(false)
  })
})
