import type { HTMLAttributes } from 'react'
import './ui.css'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
}

/**
 * Badge no padrao do shadcn/ui (rounded-full, variantes por cor), adaptado ao
 * CSS plain do projeto. Por padrao e mais transparente para nao roubar a
 * atencao; no hover a opacidade volta ao normal.
 */
export function Badge({ variant = 'default', className = '', ...props }: BadgeProps) {
  const classes = ['ui-badge', `ui-badge-${variant}`]
  if (className) classes.push(className)
  return <span data-slot="badge" className={classes.join(' ')} {...props} />
}
