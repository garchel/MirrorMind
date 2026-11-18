import type { ReactNode } from 'react'
import { matchesQuery, useSettingsSearch } from './settingsSearch'

/**
 * Bloco das Configurações: título com semântica de heading (o `<h3>` deixa o
 * documento com outline; antes era um `<p>` estilizado, que só funcionava para
 * o `aria-labelledby`), descrição opcional e conteúdo.
 *
 * `tone="danger"` marca a seção de ações destrutivas — antes "apagar dados"
 * morava ao lado da versão do app, com o mesmo peso de uma informação.
 */
type Props = {
  id: string
  title: string
  description?: ReactNode
  /** Palavras extras para a busca (sinônimos que não aparecem no título). */
  keywords?: string
  tone?: 'default' | 'danger'
  children: ReactNode
}

export function SettingSection({
  id,
  title,
  description,
  keywords = '',
  tone = 'default',
  children,
}: Props) {
  const { query } = useSettingsSearch()
  const match = matchesQuery(
    query,
    title,
    typeof description === 'string' ? description : '',
    keywords,
  )

  return (
    <section
      className="settings-section"
      id={`settings-${id}`}
      aria-labelledby={`settings-${id}-title`}
      data-match={match}
      data-tone={tone}
    >
      <h3 className="card-kicker" id={`settings-${id}-title`}>{title}</h3>
      {description ? <p className="settings-section-description">{description}</p> : null}
      {children}
    </section>
  )
}
