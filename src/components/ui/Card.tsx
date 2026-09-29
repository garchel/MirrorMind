import type { ElementType, HTMLAttributes, ReactNode } from 'react'

/**
 * Superficie elevada com contorno.
 *
 * O token ja existia (`--card-*` em component.css) sem consumidor
 * nenhum. Este componente da a ele uma forma, e separa Card de
 * Panel: Card e a superficie de conteudo (padding 18px, radius xl);
 * Panel e o wrapper de dialogo/drawer, que usa o mesmo vocabulario com
 * raio maior e sem sombra. Os dois sao a mesma casca com escala
 * diferente — por isso um componente so, com `as="section"`.
 *
 * `className` aberto, como no Button e no Field: o ajuste de contexto
 * vence porque o selutor tem mais classes que `.ui-card`.
 */

type CardProps = HTMLAttributes<HTMLElement> & {
  /** Tag do elemento. 'section' por padrao; 'article', 'li', 'div'… */
  as?: ElementType
  /** Elemento que da titulo ao card, para leitores de tela. */
  title?: string
  /** Se false, o card nao ganha o preenchimento padrao de 18px. */
  padded?: boolean
  children?: ReactNode
}

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function Card({ as, title, padded = true, className, children, ...rest }: CardProps) {
  const El = (as ?? 'section') as ElementType
  return (
    <El
      className={cx('ui-card', !padded && 'ui-card--flush', className)}
      {...(title ? { 'aria-label': title } : {})}
      {...rest}
    >
      {children}
    </El>
  )
}
