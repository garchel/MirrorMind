import { forwardRef } from 'react'
import type {
  InputHTMLAttributes,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

/**
 * Campo de formulario — input, select e textarea como um so componente.
 *
 * Por que um componente so
 * ------------------------
 * A auditoria da camada 3 achou 107 <input>, 14 <select> e 7 <textarea>.
 * Desses, so 25 tinham className; o resto herdava o reset global de
 * base.css. Ou seja: nao havia um "campo" no app, havia tres tags com
 * estilos diferentes dependendo de onde apareciam. E o que os tokens
 * `--field-*` em component.css ja descreviam — 48px de altura, radius
 * xl, focus no accent — nunca foi lido por ninguem.
 *
 * Este componente fecha o ciclo: os tokens passam a ter consumidor.
 *
 * Contrato
 * --------
 * - `as` escolhe a tag; o resto da API e o da tag nativa.
 * - `size` e a densidade, medida do app: `sm` 36px (o .settings-select
 *   e o .settings-number reais), `md` 48px (o .field input real).
 * - `className` fica aberto para ajuste de contexto, pelo mesmo motivo
 *   do Button: 19 das regras antigas sao override de 2-3 classes e
 *   perdem para uma regra generica de especificidade baixa.
 */

type Density = {
  /**
   * Densidade, medida do CSS fonte do app:
   *   xs = 34px  (.settings-number, .field input do workspace-chrome)
   *   sm = 36px  (.settings-select)
   *   md = 48px  (.field input do base.css, o campo do vault)
   *
   * O padrao e xs, nao md: 34px e a altura mais comum do app, e o
   * `.field input` de 48px e uma excecao do vault. Errar para o lado
   * menor mantem a migracao visualmente neutra — a regra de contexto
   * continua mandando.
   */
  size?: 'xs' | 'sm' | 'md'
  /** Rotulo acessivel quando nao ha <label> visual associado. */
  label?: string
  /** Ajuste de contexto. Entra depois das classes do componente. */
  className?: string
}

// `size` precisa sair da intersecao: InputHTMLAttributes ja declara
// `size?: number`, e `'sm' | 'md' & number` nunca sera assignable.
// Sem o Omit, o TS colapsa o campo e `size="sm"` vira erro de tipo.
type Common = Omit<
  InputHTMLAttributes<HTMLInputElement> &
    SelectHTMLAttributes<HTMLSelectElement> &
    TextareaHTMLAttributes<HTMLTextAreaElement>,
  'size'
>

/**
 * Por que nao e uma uniao discriminada
 * ------------------------------------
 * A primeira versao usava `{as?: 'input'} | {as: 'select'} | {as:
 * 'textarea'}`. Com forwardRef isso nao compila: o React junta
 * RefAttributes<T> as props, e o TS passa a exigir `as` no ramo mais
 * especifico, tornando-o obrigatorio ate no input — que deveria ser o
 * padrao. Quebrar o generic nao resolveu, porque o P ainda e
 * inferido do ref.
 *
 * A uniao so funciona se o componente nao for forwardRef. Como o ref
 * e necessario (o .settings-number e controlado por fora), a saida e
 * `as` como string opcional sobre a intersecoes dos atributos. O
 * contra-tipo: `as="select"` aceita props de input. Em troca, o
 * componente aceita qualquer chamada valida, e o TS nao inventa
 * obrigatoriedade que nao existe.
 */
export type FieldProps = Density & {
  /** Tag renderizada. 'input' por padrao. */
  as?: 'input' | 'select' | 'textarea'
} & Common

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function classes(size: 'xs' | 'sm' | 'md', className?: string, extra?: string) {
  return cx('ui-field', extra, `ui-field--${size}`, className)
}

type Props = FieldProps
type Element = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function FieldImpl(props: Props, ref: Ref<Element>) {
  const { as, size = 'xs', label, className, ...rest } = props

  const aria = label ? { 'aria-label': label } : {}

  if (as === 'select') {
    return (
      <select
        {...(rest as SelectHTMLAttributes<HTMLSelectElement>)}
        {...aria}
        ref={ref as Ref<HTMLSelectElement>}
        className={classes(size, className)}
      />
    )
  }

  if (as === 'textarea') {
    return (
      <textarea
        {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        {...aria}
        ref={ref as Ref<HTMLTextAreaElement>}
        className={classes(size, className, 'ui-field--textarea')}
      />
    )
  }

  return (
    <input
      {...(rest as InputHTMLAttributes<HTMLInputElement>)}
      {...aria}
      ref={ref as Ref<HTMLInputElement>}
      className={classes(size, className)}
    />
  )
}

export const Field = forwardRef<Element, Props>(FieldImpl)
