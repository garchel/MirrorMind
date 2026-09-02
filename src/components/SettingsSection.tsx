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
  title,
  description,
  aside,
  className,
  children,
}: {
  id: string
  kicker: string
  title: string
  description?: string
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={['settings-section', className].filter(Boolean).join(' ')} aria-labelledby={id}>
      <div className="settings-section-heading">
        <div>
          <p className="card-kicker">{kicker}</p>
          <h3 id={id}>{title}</h3>
          {description ? <small>{description}</small> : null}
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}
