import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Botao do MirrorMind — a unica forma de botao nova no app.
 *
 * Antes desta mudanca nao havia primitivo: 184 botoes usavam
 * `className="secondary-button"` inline, e o CSS tinha 42 regras para
 * tres nomes de classe. Este componente nao absorve as 42: ele expoe o
 * que tem significado e deixa o resto passar.
 *
 * O contrato
 * -----------
 *   variant  significado. primary e tinta cheia (um por tela).
 *            secondary e o padrao. danger e acao destrutiva.
 *   size     densidade. Vem das 6 alturas realmente em uso no app,
 *            agrupadas em 3 faixas:
 *              xs   24/26/28px  glifo solto (rail, header, menu)
 *              sm   30/34px    compacto (dialog, popover, tag)
 *              md   40px       padrao de pagina
 *   className  ajuste de contexto. 21 das 42 regras do CSS antigo
 *            eram so geometria por seletor de 3 classes
 *            (`.workspace-shell .history-actions .secondary-button`),
 *            e sao elas que distinguem o botao de 28px do rail do de
 *            40px do header. Quem nao cabe em `size` passa por aqui.
 *
 * Por que `className` continua aberto
 * ----------------------------------
 * O commentario do proprio CSS antigo dizia: "o seletor em 3 classes
 * vence o `.secondary-button` do workspace". Isso e verdade sobre a
 * cascata e continua verdade depois desta migration: um `size="sm"`
 * genérico sobrescreveria a media-query densa do workspace e o botao
 * estouraria o trilho. Fingir que os 3 tamanhos resolvem tudo seria
 * reescrever 42 regras como se fossem 3.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Glifo opcional antes do rotulo. Nao recebe estilo proprio. */
  icon?: ReactNode
  children?: ReactNode
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'ui-button--primary',
  secondary: 'ui-button--secondary',
  danger: 'ui-button--danger',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: 'ui-button--xs',
  sm: 'ui-button--sm',
  md: 'ui-button--md',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = 'secondary', size = 'md', icon, children, className, type, ...rest },
    ref,
  ) {
    const classes = [
      'ui-button',
      VARIANT_CLASS[variant],
      SIZE_CLASS[size],
      // A classe antiga continua sendo emitida: as 42 regras de
      // `.secondary-button` do CSS existente ainda casam, e remover
      // agora trocaria a aparencia de 184 botois de uma vez. A
      // migracao e por ondas; enquanto `secondary-button` estiver no
      // className, o componente e um atalho, nao uma fonte de
      // verdade.
      variant === 'secondary' ? 'secondary-button' : undefined,
      variant === 'primary' ? 'primary-button' : undefined,
      variant === 'danger' ? 'danger-button' : undefined,
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <button ref={ref} type={type ?? 'button'} className={classes} {...rest}>
        {icon ? (
          <span className="ui-button__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {children}
      </button>
    )
  },
)
