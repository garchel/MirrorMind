import type { ReactNode } from 'react'
import './SettingsSection.css'

/** Cabeçalho padrão das seções de configuração: kicker + título `h3` +
 * descrição opcional e um adorno à direita (ícone, "revisão N").
 *
 * Unifica os blocos `*-heading` antes triplicados nos CSS de
 * review-notification/segmentation/vault-review-policy — que titulavam a
 * seção com o próprio kicker em micro-caps, sem elemento de heading. */
export function SettingsSection({
  id,
  kicker,
  headingLevel = 3,
  title,
  description,
  aside,
  className,
  children,
}: {
  id: string
  /** Micro-caps acima do titulo. Opcional: dentro de uma secao que ja tem
   * kicker (as de Revisao, por exemplo), repetir "Revisão" em cada bloco e
   * ruido. */
  kicker?: string
  /** Nivel do titulo no outline. 3 quando o bloco abre a area; 4 quando mora
   * dentro de uma secao das Configuracoes (que ja tem o h3). */
  headingLevel?: 2 | 3 | 4
  title: string
  description?: string
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  return (
    <div
      className={['settings-section', className].filter(Boolean).join(' ')}
      data-level={headingLevel}
      aria-labelledby={id}
    >
      <div className="settings-section-heading">
        <div>
          {kicker ? <p className="card-kicker">{kicker}</p> : null}
          <Heading id={id}>{title}</Heading>
          {description ? <small>{description}</small> : null}
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}
