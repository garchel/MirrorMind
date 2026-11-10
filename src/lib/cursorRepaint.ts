import { nudgeCursor } from './nudgeCursor'

/**
 * Recuperacao sistemica do cursor branco do WebView2/Windows.
 *
 * O problema
 * ----------
 * O compositor do WebView2, ao trocar a FORMA do cursor (seta -> I-beam ao
 * entrar no editor) ou ao montar uma camada nova sob o ponteiro (popover
 * portalado), as vezes deixa o cursor do SO preso na variante branca: ele
 * perde o contorno preto e fica invisivel no tema claro. Nao e CSS nosso —
 * `color-scheme: light` no `:root` ja garante a variante preta do I-beam;
 * e o compositor que nao redesenha.
 *
 * A correcao definitiva do I-beam e o `--text-cursor` (index.css): uma
 * imagem SVG desenhada pelo Chromium, que nao depende do bitmap do SO.
 * Este vigia continua cobrindo os outros cursores (seta presa depois de
 * pagina/portal) e e barato.
 *
 * Por que global
 * --------------
 * O remedio sempre foi o mesmo (`nudgeCursor`, que forca uma troca de
 * cursor por alguns ms), mas estava aplicado componente a componente:
 * App (troca de pagina/entrada no editor), NoteTagRow, tooltip do
 * dicionario, peek de post-it. Cada componente novo nascia sem o remendo e
 * o bug voltava. Este modulo observa o estado global e reemite o cursor
 * quando a transicao acontece, entao NAO e preciso lembrar de nada ao criar
 * um componente novo.
 *
 * Custo
 * -----
 * - `pointermove` e avaliado no maximo a cada ~80ms (12x/s), nunca por
 *   pixel; so a troca de forma para/de `text` dispara.
 * - O `MutationObserver` olha apenas `document.body` (a origem dos
 *   portais do Radix e do App) e e desduplicado com o mesmo throttle.
 */
export const CURSOR_CHECK_INTERVAL_MS = 80
export const CURSOR_NUDGE_INTERVAL_MS = 120

/** So a transicao para/de I-beam e o gatilho conhecido do cursor branco. */
export function shouldRepaintCursor(previous: string | null, next: string): boolean {
  if (previous === null || previous === next) return false
  return previous === 'text' || next === 'text'
}

/** Instala os vigias; devolve a funcao de limpeza (para o useEffect). */
export function installCursorRepaint(): () => void {
  let lastCursor: string | null = null
  let lastCheck = -Infinity
  let lastNudge = -Infinity

  const nudge = () => {
    const now = performance.now()
    if (now - lastNudge < CURSOR_NUDGE_INTERVAL_MS) return
    lastNudge = now
    nudgeCursor(30)
  }

  const onPointerMove = (event: PointerEvent) => {
    const now = performance.now()
    if (now - lastCheck < CURSOR_CHECK_INTERVAL_MS) return
    lastCheck = now
    const target = event.target
    if (!(target instanceof Element)) return
    const cursor = getComputedStyle(target).cursor
    if (cursor === lastCursor) return
    const previous = lastCursor
    lastCursor = cursor
    if (shouldRepaintCursor(previous, cursor)) nudge()
  }

  // Portal novo = camada de composicao nova sob o ponteiro. Radix
  // (popover/menu/tooltip) e os portais do App anexam direto no body.
  const observer = new MutationObserver((records) => {
    const addedElement = records.some((record) =>
      [...record.addedNodes].some((node) => node instanceof Element),
    )
    if (addedElement) nudge()
  })
  observer.observe(document.body, { childList: true })

  document.addEventListener('pointermove', onPointerMove, true)
  return () => {
    document.removeEventListener('pointermove', onPointerMove, true)
    observer.disconnect()
  }
}
