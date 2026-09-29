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
 * vence porque o seletor tem mais classes que `.ui-card`.
 *
 * Sobre `padded={false}`
 * ----------------------
 * Os cartoes que existem hoje no app nao usam os 18px do token:
 * `.retention-card` e 14px 16px com raio lg, `.sk-stat-card` e 14px
 * tambem com raio lg. Isso e escolha, nao esquecimento — sao blocos
 * densos de leitura, nao superficies de conteudo. Por isso eles NAO
 * foram migrados: emitir <Card> trocaria o padding e o raio.
 *
 * A correcao aqui seria alinhar o token a geometria real (14px,
 * radius-lg) e dar ao <Card> um `density` para o caso dos 18px. Isso
 * e decisao de design, nao de refatoracao — e por isso fica para o
 * usuario escolher, e nao foi feito no escuro.
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
