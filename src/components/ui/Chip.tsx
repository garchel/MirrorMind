import type { HTMLAttributes, ReactNode } from 'react'

/**
 * Rotulo inline: tag, status, contagem.
 *
 * O token `--chip-*` ja existia sem consumidor. A distincao que o
 * codigo carrega e a de Badge: um Chip nao e clicavel e nao tem hover
 * proprio — so muda de opacidade para nao roubar atencao. Por isso ele
 * nao aceita onClick de proposito: se precisa ser clicavel, e um
 * Button, e o Button ja resolve.
 */

type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  /** Tom do chip. 'neutral' por padrao; 'accent' e 'danger' sao os que
   * o app ja usava em contexto. */
  tone?: 'neutral' | 'accent' | 'danger'
  children?: ReactNode
}

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function Chip({ tone = 'neutral', className, children, ...rest }: ChipProps) {
  return (
    <span className={cx('ui-chip', `ui-chip--${tone}`, className)} {...rest}>
      {children}
    </span>
  )
}
