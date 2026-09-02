/** Abre um `<dialog>` nativo (Esc + backdrop + foco grátis); com fallback para
 * ambientes sem `showModal` (jsdom nos testes). */
export function openDialog(dlg: HTMLDialogElement): void {
  try {
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal()
    else if (!dlg.open) dlg.setAttribute('open', '')
  } catch {
    if (!dlg.open) dlg.setAttribute('open', '')
  }
}

/** Fecha o diálogo, com o mesmo fallback do `openDialog`. */
export function closeDialog(dlg: HTMLDialogElement): void {
  try {
    if (dlg.open) dlg.close()
  } catch {
    /* jsdom sem suporte total: remove o atributo manualmente */
  }
  dlg.removeAttribute('open')
}
