import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { remarkSetextDividerAsSeparator } from './remarkSetextDivider'

function renderReading(markdown: string) {
  return render(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkSetextDividerAsSeparator]}>{markdown}</ReactMarkdown>,
  ).container
}

describe('modo Leitura: --- abaixo de um paragrafo e divisor, nao heading', () => {
  it('linha com palavra em negrito + ---: sem h2, so o paragrafo e o <hr>', () => {
    const container = renderReading('O processo é **autotrófico**.\n---')
    expect(container.querySelector('h2')).toBeNull()
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('hr')).not.toBeNull()
    // Nenhuma linha vira titulo: o texto fica em paragrafo normal.
    const p = container.querySelector('p')
    expect(p?.textContent).toBe('O processo é autotrófico.')
    expect(p?.querySelector('strong')?.textContent).toBe('autotrófico')
  })

  it('caso exato reportado: definicao inteira em negrito + ---', () => {
    const line = 'Processo autotrófico realizado por plantas, algas e cianobactérias para converter energia luminosa em energia química (glicose). Ocorre no cloroplasto.'
    const container = renderReading(`**${line}**\n---`)
    expect(container.querySelector('h2')).toBeNull()
    expect(container.querySelector('hr')).not.toBeNull()
    const p = container.querySelector('p')
    expect(p?.querySelector('strong')?.textContent).toBe(line)
  })

  it('linha sem negrito + --- tambem vira paragrafo + divisor (nao h2)', () => {
    const container = renderReading('Processo autotrófico.\n---\n\nDepois.')
    expect(container.querySelector('h2')).toBeNull()
    expect(container.querySelectorAll('hr').length).toBe(1)
    expect(container.querySelectorAll('p').length).toBe(2)
  })

  it('heading === continua sendo heading de nivel 1', () => {
    const container = renderReading('Titulo\n===')
    expect(container.querySelector('h1')?.textContent).toBe('Titulo')
    expect(container.querySelector('hr')).toBeNull()
  })

  it('heading ATX continua sendo heading', () => {
    const container = renderReading('## Titulo\n---')
    expect(container.querySelector('h2')?.textContent).toBe('Titulo')
    expect(container.querySelector('hr')).not.toBeNull()
  })
})

describe('paginas de review (remarkGfm + remarkMath + plugin): citacao da nota nao vira h2', () => {
  function renderReviewReport(markdown: string) {
    return render(
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkSetextDividerAsSeparator]}>{markdown}</ReactMarkdown>,
    ).container
  }

  it('definicao da nota seguida de --- (citada pela IA no relatorio) nao vira heading', () => {
    const content = [
      '**Ideia central:** Processo autotrófico realizado por plantas, algas e cianobactérias para converter energia luminosa em energia química (glicose). Ocorre no **cloroplasto**.',
      '---',
    ].join('\n')
    const container = renderReviewReport(content)
    expect(container.querySelector('h2')).toBeNull()
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('hr')).not.toBeNull()
    const p = container.querySelector('p')
    expect(p?.textContent).toContain('Processo autotrófico')
    expect(p?.querySelectorAll('strong').length).toBe(2)
  })
})
