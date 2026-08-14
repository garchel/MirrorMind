import { AlertTriangle, ListChecks, Search } from 'lucide-react'
import { parsePluginBlock, type PluginBlockLanguage } from '../lib/pluginBlocks'
import './obsidian-plugin-block.css'

type Props = {
  language: PluginBlockLanguage
  source: string
}

const HEADERS: Record<PluginBlockLanguage, { title: string; description: string }> = {
  dataview: {
    title: 'Bloco Dataview',
    description: 'Consulta renderizada somente leitura: o resultado nao e calculado aqui e a fonte permanece intacta.',
  },
  dataviewjs: {
    title: 'Bloco Dataview JS',
    description: 'JavaScript de plugin nao e executado por seguranca. O codigo-fonte e exibido sem alteracoes.',
  },
  tasks: {
    title: 'Bloco Tasks',
    description: 'Tarefas exibidas somente leitura com o estado dos checkboxes da fonte.',
  },
}

/** Renderizacao read-only de blocos de plugins do Obsidian (Dataview, Tasks):
 * nunca executa `dataviewjs`, nunca altera a fonte e mostra o codigo cru
 * preservado para o usuario copiar ou abrir no Obsidian. */
export function ObsidianPluginBlock({ language, source }: Props) {
  const block = parsePluginBlock(language, source)
  const header = HEADERS[language]
  return (
    <section className={`obsidian-plugin-block is-${language}`} aria-label={header.title}>
      <header className="obsidian-plugin-block-header">
        {language === 'tasks' ? (
          <ListChecks size={14} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Search size={14} strokeWidth={1.75} aria-hidden="true" />
        )}
        <span className="obsidian-plugin-block-title">{header.title}</span>
        <span className="obsidian-plugin-block-language">{language}</span>
      </header>
      {language === 'tasks' ? (
        block.taskLines.length > 0 ? (
          <ul className="obsidian-plugin-block-tasks">
            {block.taskLines.map((task, index) => (
              <li key={`${index}-${task.text}`} className={task.checked ? 'is-checked' : ''}>
                <span className="obsidian-plugin-block-check" aria-hidden="true">{task.checked ? '✓' : '○'}</span>
                <span>{task.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="obsidian-plugin-block-note">Nenhuma tarefa `- [ ]` encontrada no bloco.</p>
        )
      ) : null}
      <pre className="obsidian-plugin-block-source"><code>{block.source}</code></pre>
      <p className="obsidian-plugin-block-warning">
        <AlertTriangle size={12} strokeWidth={1.75} aria-hidden="true" />
        {header.description}
      </p>
    </section>
  )
}
