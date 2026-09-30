import type { HTMLAttributes } from 'react'
import './ui.css'

/**
 * Rotulo inline: tag, status, contagem, prazo.
 *
 * Este componente existia desde o padrao shadcn, com o visual inteiro
 * hardcoded no ui.css (padding 3px 9px, raio 999px, opacidade 0.62) e
 * so 1 uso no app. Os tokens `--chip-*` em component.css descreviam
 * exatamente esse rotulo — e ninguem lia.
 *
 * Duas familias de classe, nunca juntas
 * --------------------------------------
 * `.ui-chip` (o contrato por token) e `.ui-badge` (o legado do
 * ui.css) divergem em 11 propriedades: raio, padding, borda, fundo,
 * cor, gap, tracking, transition. Se as duas fossem emitidas no mesmo
 * elemento, quem venceria dependeria da ordem do bundle — e o Vite
 * nao garante a mesma ordem para CSS vindo de index.css e de um
 * `import './ui.css'` dentro de um componente. Aparelho silencioso e
 * fragil.
 *
 * Entao a regra e: uma ou outra.
 * - com `variant` legado: so `.ui-badge-*`. O NoteTagRow continua
 *   exatamente igual ate migrar para `tone`.
 * - so com `tone`: so `.ui-chip--*`, o contrato novo.
 */

type ChipTone = 'neutral' | 'accent' | 'danger'

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  /**
   * Tom no vocabulario do MirrorMind. 'neutral' e o padrao e nao rouba
   * atencao.
   */
  tone?: ChipTone
  /** Alias legado do shadcn. Preferir `tone`; ao usa-lo, o visual
   * antigo (.ui-badge-*) e preservado em vez do novo. */
  variant?: 'default' | 'secondary' | 'destructive' | 'outline'
}

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function Badge({ tone, variant, className, children, ...rest }: BadgeProps) {
  // `variant` tem precedencia: enquanto ele existir, o visual legado
  // manda e NENHUMA classe `ui-chip*` e emitida — senao as duas bases
  // brigariam pelas mesmas 11 propriedades. Quem migrar para `tone`
  // entra no contrato novo, sozinho.
  const legacy = variant !== undefined && tone === undefined
  return (
    <span
      className={cx(
        legacy ? `ui-badge ui-badge-${variant}` : `ui-chip ui-chip--${tone ?? 'neutral'}`,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
