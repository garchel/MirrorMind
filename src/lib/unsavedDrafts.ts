/** Rascunhos nao salvos no momento de fechar a janela.
 *
 *  O editor guarda um rascunho por aba (`draftsByPath`) e o conteudo do disco
 *  em que ele se baseou (`baseByPath`). Comparar os dois responde a unica
 *  pergunta que importa ao fechar: *este texto existe em algum arquivo?*
 *
 *  Comparar com o disco (e nao um booleano "sujo") tambem cobre o caso em que
 *  o usuario desfaz a edicao: o rascunho volta a ser identico a base e nao ha
 *  nada a perder — perguntar ali seria um aviso falso. */

/** Caminho da aba de nota nova: ainda nao existe arquivo para comparar. */
export const NEW_NOTE_DRAFT_PATH = '__new_note__'

export type UnsavedDraftsInput = {
  /** Caminho da nota aberta no editor, ou `null` quando nao ha nota ativa. */
  activePath: string | null
  /** Conteudo atual do editor para a nota ativa. */
  activeContent: string
  /** Rascunho guardado por aba (inclui a nota ativa). */
  draftsByPath: Record<string, string>
  /** Conteudo do disco em que cada rascunho se baseou. */
  baseByPath: Record<string, string>
}

/** Caminhos cujo rascunho difere do conteudo em que foi baseado, em ordem
 *  estavel (a nota ativa primeiro). Caminhos sem base conhecida ficam de
 *  fora: sem prova de que o arquivo mudou, o rascunho e a referencia. */
export function unsavedDraftPaths(input: UnsavedDraftsInput): string[] {
  const { activePath, activeContent, draftsByPath, baseByPath } = input
  const dirty = new Set<string>()

  const isDirty = (path: string, content: string) => {
    const base = baseByPath[path]
    return base !== undefined && content !== base
  }

  if (activePath && activePath !== NEW_NOTE_DRAFT_PATH && isDirty(activePath, activeContent)) {
    dirty.add(activePath)
  }

  for (const [path, content] of Object.entries(draftsByPath)) {
    if (path === NEW_NOTE_DRAFT_PATH) continue
    if (isDirty(path, content)) dirty.add(path)
  }

  return [...dirty]
}

/** Uma nota nova (aba `__new_note__`) so tem algo a perder quando o editor ja
 *  tem texto: sem titulo e sem conteudo ela e uma tela em branco. */
export function hasUnsavedNewNote(input: { isNewNoteDraft: boolean; activeContent: string }): boolean {
  return input.isNewNoteDraft && input.activeContent.trim().length > 0
}
