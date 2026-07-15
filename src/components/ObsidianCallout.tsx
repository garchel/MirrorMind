import type { ReactNode } from 'react'
import { AlertTriangle, Bug, CheckCircle2, CircleHelp, Flame, Info, Lightbulb, ListTodo, NotebookPen, Quote } from 'lucide-react'

type ObsidianCalloutProps = {
  children: ReactNode
  defaultCollapsed: boolean
  foldable: boolean
  title: ReactNode
  type: string
}

const CALLOUT_LABELS: Record<string, string> = {
  abstract: 'Resumo',
  attention: 'Atencao',
  bug: 'Bug',
  caution: 'Cuidado',
  check: 'Concluido',
  danger: 'Perigo',
  done: 'Concluido',
  error: 'Erro',
  example: 'Exemplo',
  failure: 'Falha',
  faq: 'Pergunta',
  help: 'Ajuda',
  hint: 'Dica',
  important: 'Importante',
  info: 'Informacao',
  missing: 'Ausente',
  note: 'Nota',
  question: 'Pergunta',
  quote: 'Citacao',
  success: 'Sucesso',
  summary: 'Resumo',
  tip: 'Dica',
  tldr: 'Resumo',
  todo: 'Tarefa',
  warning: 'Aviso',
}

function calloutIcon(type: string) {
  if (['success', 'check', 'done'].includes(type)) return CheckCircle2
  if (['warning', 'caution', 'attention', 'failure', 'fail', 'missing'].includes(type)) return AlertTriangle
  if (['danger', 'error'].includes(type)) return Flame
  if (['question', 'help', 'faq'].includes(type)) return CircleHelp
  if (['tip', 'hint', 'important'].includes(type)) return Lightbulb
  if (['quote', 'cite'].includes(type)) return Quote
  if (type === 'bug') return Bug
  if (type === 'todo') return ListTodo
  if (type === 'note') return NotebookPen
  return Info
}

export function ObsidianCallout({ children, defaultCollapsed, foldable, title, type }: ObsidianCalloutProps) {
  const normalizedType = type.toLowerCase()
  const Icon = calloutIcon(normalizedType)
  const label = title || CALLOUT_LABELS[normalizedType] || normalizedType.replace(/[-_]+/g, ' ')
  const header = (
    <span className="obsidian-callout-title">
      <Icon aria-hidden="true" size={16} strokeWidth={1.7} />
      <span>{label}</span>
    </span>
  )

  if (foldable) {
    return (
      <details className="obsidian-callout" data-callout={normalizedType} open={!defaultCollapsed}>
        <summary>{header}</summary>
        <div className="obsidian-callout-content">{children}</div>
      </details>
    )
  }

  return (
    <aside className="obsidian-callout" data-callout={normalizedType}>
      <div className="obsidian-callout-header">{header}</div>
      <div className="obsidian-callout-content">{children}</div>
    </aside>
  )
}
