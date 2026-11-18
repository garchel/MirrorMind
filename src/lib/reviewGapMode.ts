/**
 * Como as lacunas da última revisão aparecem na nota (Misto e Leitura).
 *
 * `always` — halo sempre visível; `hover` — nota limpa, halo no hover;
 * `off` — só os destaques do usuário.
 *
 * Mora aqui, e não na página de Configurações: o ajuste é do cabeçalho da nota
 * (aparece quando a nota tem lacunas), e a Configurações não é mais dona dele.
 */
export type ReviewGapMode = 'always' | 'hover' | 'off'

export const DEFAULT_REVIEW_GAP_MODE: ReviewGapMode = 'hover'
