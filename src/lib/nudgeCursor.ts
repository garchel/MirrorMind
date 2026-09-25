/** Recuperacao do cursor do WebView2/Windows: apos mudancas de composicao
 * (trocar de pagina, entrar no editor — o I-beam, montar o canvas WebGL do
 * grafo, abrir um popover portalado), o Chromium as vezes deixa o cursor do
 * SO preso renderizado branco (perde a parte preta e fica invisivel no tema
 * claro). Forcar uma mudanca de cursor por um instante faz o compositor
 * redesenhar o cursor nativo — o mesmo mecanismo do workaround classico de
 * "minimizar/restaurar" a janela.
 * `durationMs` curto (30-40ms) para nao piscar o cursor. */
export function nudgeCursor(durationMs = 40) {
  const style = document.createElement('style')
  style.textContent = '* { cursor: auto !important; }'
  document.head.appendChild(style)
  const counterWindow = window as unknown as { __mirrormindNudgeCount?: number }
  counterWindow.__mirrormindNudgeCount = (counterWindow.__mirrormindNudgeCount ?? 0) + 1
  window.setTimeout(() => style.remove(), durationMs)
}
