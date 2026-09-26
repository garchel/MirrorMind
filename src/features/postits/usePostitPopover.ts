import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEscapeToClose } from '../../lib/escapeStack'
import {
  addNotePostit,
  deriveAnchorFromParagraph,
  deriveRangeAnchorFromSelection,
  getNotePostits,
  POSTIT_MAX_CHARS,
  POSTIT_QUOTE_MAX_CHARS,
  removeNotePostit,
  resolvePostitAnchors,
  resolvePostitRange,
  updateNotePostit,
  type NotePostit,
  type PostitColor,
  type PostitRangeAnchor,
} from '../../lib/postits'
import type { PostitData } from '../../components/markdownLivePreview'

/** Estado do popover de post-it (criacao ou edicao). */
export type PostitPopoverState = {
  postitId: string | null
  /** Offset do paragrafo ancorado no doc do editor (posicao do pino). */
  anchorFrom: number | null
  /** Ancora de frase capturada da selecao (null = post-it de paragrafo). */
  pendingRange: PostitRangeAnchor | null
  /** Peek por hover: aberto sem roubar o foco; qualquer interacao fixa. */
  peek?: boolean
  /** Estado de criacao: cor inicial + texto digitado antes de salvar. */
  draftText: string
  draftColor: PostitColor
  /** Posicao do popover relativa ao painel .editor-content. */
  x: number
  y: number
  flip: boolean
  /** Confirmacao de exclusao armada (primeiro clique) — o segundo apaga. */
  deleteArmed: boolean
}

export type PostitEditorAccess = {
  getSelection: () => { value: string; selectionStart: number; selectionEnd: number } | null
  getParagraphStartAt: (from: number) => number | null
  getParagraphTextAt: (from: number) => string | null
  getSelectionRect: () => { bottom: number; left: number; right: number; top: number } | null
  getRectAt: (from: number) => { bottom: number; left: number; right: number; top: number } | null
  editorContent: () => HTMLElement | null
}

export type UsePostitPopoverDeps = {
  draftContent: string
  setDraftContent: React.Dispatch<React.SetStateAction<string>>
  noteBody: string
  hasActiveNote: boolean
  editorMode: 'mixed' | 'edit' | 'read'
  /** Banner de erro (role=alert) para bloqueios de area. */
  reportError: (message: string) => void
  editor: PostitEditorAccess
}

/** Dominio dos post-its (extraido do App): estado do popover, commit com
 * auto-save, resize, ancora por frase, peek por hover e resolucao das
 * ancoras para o doc do editor ativo. */
export function usePostitPopover(deps: UsePostitPopoverDeps) {
  const { draftContent, setDraftContent, noteBody, hasActiveNote, editorMode, reportError, editor } = deps

  // Post-its: popover aberto (criacao ou edicao). `anchorFrom` e o offset do
  // inicio do paragrafo no doc do editor ativo; `postitId` null = novo post-it.
  const [postitPopover, setPostitPopover] = useState<PostitPopoverState | null>(null)
  const postitPopoverRef = useRef<HTMLDivElement | null>(null)
  const postitSaveTimerRef = useRef<number | null>(null)
  /** Tamanho do popover redimensionado pelo handle (null = padrao do CSS). */
  const [postitPopoverSize, setPostitPopoverSize] = useState<{ width: number; height: number } | null>(null)
  /** Ultimo snapshot commitado (evita commit redundante no auto-save). */
  const postitLastCommittedRef = useRef<{ id: string | null; text: string; color: PostitColor; rangeKey: string } | null>(null)
  /** Handlers de commit/flush do post-it canalizados por ref: os efeitos de
   * auto-save e clique-fora sempre chamam a versao mais recente sem entrar
   * nas deps (padrao do useEffectEvent, compativel com o lint de hooks). */
  const postitHandlersRef = useRef<{ commit: (popover: PostitPopoverState) => boolean; flush: () => void } | null>(null)
  /** Modo "armado" da troca de area: apos clicar em "Alterar area", o
   * popover ignora o clique-fora para o usuario conseguir selecionar o
   * trecho com o mouse (o mousedown fecharia tudo). Escape/X fecha e
   * desarma. Espelho em ref para o listener de mousedown. */
  const [postitRangeArming, setPostitRangeArming] = useState(false)
  const postitRangeArmingRef = useRef(false)
  postitRangeArmingRef.current = postitRangeArming
  /** Peek por hover: id com previa aberta + timer de fechamento com
   * tolerancia para atravessar ate o popover. */
  const postitPeekIdRef = useRef<string | null>(null)
  const postitPeekCloseTimerRef = useRef<number | null>(null)
  // Fecha o popover ao clicar fora (mesmo padrao do dropdown de tags). Com
  // auto-save, fechar PRIMEIRO comita mudancas pendentes (debounce nao
  // disparado) — o rascunho nunca se perde por fechar cedo.
  useEffect(() => {
    if (!postitPopover) return
    const closePopover = (event: globalThis.MouseEvent) => {
      if (postitRangeArmingRef.current) return
      if (postitPopoverRef.current && !postitPopoverRef.current.contains(event.target as Node)) {
        postitHandlersRef.current?.flush()
        setPostitPopover(null)
        setPostitPopoverSize(null)
        postitPeekIdRef.current = null
        if (postitPeekCloseTimerRef.current !== null) {
          window.clearTimeout(postitPeekCloseTimerRef.current)
          postitPeekCloseTimerRef.current = null
        }
      }
    }
    window.addEventListener('mousedown', closePopover)
    return () => window.removeEventListener('mousedown', closePopover)
  }, [postitPopover])

  /** Selecao do editor ativo (null no modo Leitura, como no App). */
  function getActiveEditorSelection() {
    if (editorMode === 'read') return null
    return editor.getSelection()
  }

  // Post-its do draft: resolve as ancoras (texto do paragrafo + ordinal) para
  // offsets do doc do editor ATIVO. Misto edita `draftContent` (offsets com
  // frontmatter); Leitura renderiza `noteBody` (sem frontmatter) — por isso o
  // bodyStartOffset depende do modo. Orfaos (paragrafo sumiu) ficam de fora
  // dos widgets, mas permanecem salvos no frontmatter.
  const notePostits = useMemo(() => getNotePostits(draftContent), [draftContent])
  const postitData = useMemo<PostitData | null>(() => {
    if (!hasActiveNote || editorMode === 'edit') return null
    const bodyStartOffset = editorMode === 'read' ? 0 : draftContent.length - noteBody.length
    const resolved = resolvePostitAnchors(notePostits, noteBody, 0)
    const anchored: Array<{ postit: NotePostit; from: number; range: { from: number; to: number } | null }> = []
    const orphans: NotePostit[] = []
    for (const { postit, from, range } of resolved) {
      // Orfao SO quando paragrafo E frase falham: o segundo post-it do mesmo
      // paragrafo tem ordinal alem das ocorrencias (from null) mas a faixa
      // resolve — ele deve aparecer, nao sumir.
      const rangeDoc = range ? { from: range.from + bodyStartOffset, to: range.to + bodyStartOffset } : null
      if (from === null && rangeDoc === null) {
        orphans.push(postit)
        continue
      }
      anchored.push({ postit, from: (from ?? range!.from) + bodyStartOffset, range: rangeDoc })
    }
    return { anchored, orphans }
  }, [hasActiveNote, draftContent, editorMode, noteBody, notePostits])

  /** Fecha o popover de post-it comitando mudancas pendentes (auto-save). */
  function closePostitPopover() {
    flushPendingPostitSave()
    setPostitPopover(null)
    setPostitPopoverSize(null)
    setPostitRangeArming(false)
    postitPeekIdRef.current = null
    if (postitPeekCloseTimerRef.current !== null) {
      window.clearTimeout(postitPeekCloseTimerRef.current)
      postitPeekCloseTimerRef.current = null
    }
  }

  /** Persiste de fato o post-it (cria ou atualiza) e devolve true quando
   * gravou. Usado pelo auto-save com debounce e pelo Ctrl+Enter. */
  function commitPostitNow(popover: PostitPopoverState): boolean {
    if (popover.postitId === null) {
      // Criacao: precisa de ancora e texto — sem texto, apenas descarta.
      if (popover.anchorFrom === null) return false
      const anchorText = postitAnchorTextAt(popover.anchorFrom)
      if (anchorText === null) return false
      const text = popover.draftText.trim()
      if (!text) return false
      const result = addNotePostit(draftContent, { anchorText, color: popover.draftColor, text, range: popover.pendingRange })
      if (result.error) return false
      setDraftContent(result.content)
      // Vira edicao do post-it criado: proximos auto-saves atualizam.
      setPostitPopover((current) => current ? { ...current, postitId: result.postits[result.postits.length - 1].id } : current)
      postitLastCommittedRef.current = { id: null, text: popover.draftText, color: popover.draftColor, rangeKey: JSON.stringify(popover.pendingRange ?? null) }
      return true
    }
    const text = popover.draftText.trim()
    if (!text) {
      // Texto vazio em post-it existente: remove (auto-save exclusao).
      const result = removeNotePostit(draftContent, popover.postitId)
      if (!result.error) setDraftContent(result.content)
      return true
    }
    const result = updateNotePostit(draftContent, popover.postitId, {
      text,
      color: popover.draftColor,
      // So toca na area quando o popover capturou uma (re-ancoragem); senao
      // a citacao salva e preservada.
      ...(popover.pendingRange ? { range: popover.pendingRange } : {}),
    })
    if (result.error) return false
    setDraftContent(result.content)
    postitLastCommittedRef.current = { id: popover.postitId, text: popover.draftText, color: popover.draftColor, rangeKey: JSON.stringify(popover.pendingRange ?? null) }
    return true
  }

  /** Auto-save do popover: debounce de 600ms apos a ultima digitacao. Um novo
   * post-it vira persistente na primeira gravacao bem-sucedida. O snapshot
   * commitado evita re-commit redundante quando a criacao seta o postitId. */
  useEffect(() => {
    if (!postitPopover) return
    const lastCommitted = postitLastCommittedRef.current
    if (lastCommitted
      && lastCommitted.id === postitPopover.postitId
      && lastCommitted.text === postitPopover.draftText
      && lastCommitted.color === postitPopover.draftColor
      && lastCommitted.rangeKey === JSON.stringify(postitPopover.pendingRange ?? null)
    ) return
    if (postitPopover.postitId === null && postitPopover.draftText.trim() === '') return
    const timer = window.setTimeout(() => {
      if (postitHandlersRef.current?.commit(postitPopover)) {
        postitLastCommittedRef.current = { id: postitPopover.postitId, text: postitPopover.draftText, color: postitPopover.draftColor, rangeKey: JSON.stringify(postitPopover.pendingRange ?? null) }
      }
    }, 600)
    postitSaveTimerRef.current = timer
    return () => window.clearTimeout(timer)
  }, [postitPopover])

  /** Commit imediato pendente antes de fechar/abandonar o popover (Escape,
   * clique-fora, troca de nota): cancela o debounce e grava já. */
  function flushPendingPostitSave() {
    const popover = postitPopover
    if (!popover) return
    if (postitSaveTimerRef.current !== null) {
      window.clearTimeout(postitSaveTimerRef.current)
      postitSaveTimerRef.current = null
    }
    const lastCommitted = postitLastCommittedRef.current
    if (lastCommitted
      && lastCommitted.id === popover.postitId
      && lastCommitted.text === popover.draftText
      && lastCommitted.color === popover.draftColor
      && lastCommitted.rangeKey === JSON.stringify(popover.pendingRange ?? null)
    ) return
    if (popover.postitId === null && popover.draftText.trim() === '') return
    if (commitPostitNow(popover)) {
      postitLastCommittedRef.current = { id: popover.postitId, text: popover.draftText, color: popover.draftColor, rangeKey: JSON.stringify(popover.pendingRange ?? null) }
    }
  }

  // Canal dos handlers (sempre a versao mais recente) para os efeitos de
  // auto-save e clique-fora — sem entra-los nas deps dos useEffects.
  postitHandlersRef.current = { commit: commitPostitNow, flush: flushPendingPostitSave }

  // Popover de post-it na pilha global de Escape (dialog mais recente fecha
  // primeiro).
  useEscapeToClose(Boolean(postitPopover), closePostitPopover)

  /** Arrasto do canto inferior direito: redimensiona o papel (largura+altura
   * em estado, clampado ao painel .editor-content). O popover e centralizado
   * no ancora (`translateX(-50%)`), entao sem correcao a largura cresceria
   * para os dois lados e invadiria o explorador a esquerda: a cada passo o
   * `x` anda metade do delta da largura, fixando a borda esquerda onde o
   * arrasto comecou — o crescimento vai so para a direita (e para baixo).
   * Padrao do drag da toolbar flutuante (pointermove/up no window,
   * capturado no down). */
  const postitResizeStartRef = useRef<{ pointerX: number; pointerY: number; width: number; height: number; anchorX: number } | null>(null)

  function startPostitPopoverResize(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return
    const popover = postitPopoverRef.current
    const anchor = postitPopover
    if (!popover || !anchor) return
    event.preventDefault()
    const rect = popover.getBoundingClientRect()
    postitResizeStartRef.current = { pointerX: event.clientX, pointerY: event.clientY, width: rect.width, height: rect.height, anchorX: anchor.x }
    const move = (moveEvent: PointerEvent) => {
      const start = postitResizeStartRef.current
      if (!start) return
      const newWidth = Math.max(220, Math.min(start.width + moveEvent.clientX - start.pointerX, 480))
      setPostitPopoverSize({
        width: newWidth,
        height: Math.max(150, start.height + moveEvent.clientY - start.pointerY),
      })
      // Borda esquerda fixa em (anchorX - largura inicial / 2): com o
      // centramento, `x - largura / 2` e a borda — anda junto com a largura.
      const pinnedLeft = start.anchorX - start.width / 2
      setPostitPopover((current) => current ? { ...current, x: pinnedLeft + newWidth / 2 } : current)
    }
    const stop = () => {
      postitResizeStartRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  /** Texto de ancora do paragrafo no doc do editor ativo (Misto usa
   * draftContent com frontmatter; o offset e do doc desse editor). */
  function postitAnchorTextAt(anchorFrom: number): string | null {
    const paragraphText = editor.getParagraphTextAt(anchorFrom)
    if (!paragraphText || paragraphText.trim() === '') return null
    return deriveAnchorFromParagraph(paragraphText).anchorText
  }

  /** Faixas resolvidas (coordenadas do corpo) para bloquear sobreposicao,
   * ignorando o proprio post-it na re-ancoragem. */
  function resolvedPostitBodyRanges(ignoreId: string | null): Array<{ from: number; to: number }> {
    const out: Array<{ from: number; to: number }> = []
    for (const { postit, range } of resolvePostitAnchors(notePostits, noteBody, 0)) {
      if (postit.id !== ignoreId && range) out.push(range)
    }
    return out
  }

  /** Captura a ancora de frase da selecao atual (coordenadas do corpo).
   * `paragraph` = sem selecao util (cai no pino de paragrafo, legado);
   * `blocked` = avisado via erro (fora do corpo, gigante ou sobreposta). */
  function capturePostitRangeFromSelection(ignoreId: string | null):
    | { kind: 'paragraph' }
    | { kind: 'range'; anchor: PostitRangeAnchor }
    | { kind: 'blocked' } {
    const selection = getActiveEditorSelection()
    if (!selection || selection.selectionEnd <= selection.selectionStart) return { kind: 'paragraph' }
    const bodyStartOffset = draftContent.length - noteBody.length
    const bodyFrom = selection.selectionStart - bodyStartOffset
    const bodyTo = selection.selectionEnd - bodyStartOffset
    if (bodyFrom < 0 || bodyTo > noteBody.length) {
      // `reportError` (banner com role=alert) em vez de status: o status so
      // aparece na tela de vault, nao no workspace.
      reportError('Post-it: selecione um trecho do texto da nota (fora do frontmatter).')
      return { kind: 'blocked' }
    }
    const selectedText = noteBody.slice(bodyFrom, bodyTo)
    if (!selectedText.trim()) return { kind: 'paragraph' }
    if (selectedText.length > POSTIT_QUOTE_MAX_CHARS) {
      reportError(`Post-it: selecione até ${POSTIT_QUOTE_MAX_CHARS} caracteres para a área.`)
      return { kind: 'blocked' }
    }
    const anchor = deriveRangeAnchorFromSelection(noteBody, bodyFrom, bodyTo)
    if (!anchor) return { kind: 'blocked' }
    const resolved = resolvePostitRange(anchor, noteBody)
    if (!resolved) return { kind: 'blocked' }
    // Sobreposicao parcial e permitida (bordas empilham); so area IDENTICA
    // bloqueia — duas bolinhas na mesma posicao repetiriam o bug dos pinos.
    if (resolvedPostitBodyRanges(ignoreId).some((existing) => existing.from === resolved.from && existing.to === resolved.to)) {
      reportError('Post-it: já existe um post-it exatamente nessa área.')
      return { kind: 'blocked' }
    }
    return { kind: 'range', anchor }
  }

  /** Re-ancora o post-it do popover para a selecao atual do editor. So roda
   * via botao "Confirmar area" (selecao ativa garantida pelo estado do
   * botao); o auto-save commita (o snapshot com rangeKey difere). Em
   * bloqueio, mantém armado para o usuario selecionar outro trecho. */
  function reanchorPostitToSelection() {
    if (!postitPopover || editorMode === 'read') return
    const capture = capturePostitRangeFromSelection(postitPopover.postitId)
    if (capture.kind !== 'range') return
    setPostitPopover((current) => current ? { ...current, pendingRange: capture.anchor } : current)
    setPostitRangeArming(false)
  }

  /** Abre o popover de post-it ancorado a posicao do cursor no editor. Com
   * selecao nao-colapsada, ancora a FRASE (faixa com borda); sem selecao,
   * cai no pino de paragrafo. Bloqueio (aviso via erro) nao abre nada.
   * `color` preseleciona a cor (menu do botao sticky na toolbar). */
  function openPostitPopoverAtSelection(color: PostitColor = 'yellow') {
    const selection = getActiveEditorSelection()
    const container = editor.editorContent()
    if (!selection || !container) return
    const capture = capturePostitRangeFromSelection(null)
    if (capture.kind === 'blocked') return
    const containerRect = container.getBoundingClientRect()
    const rect = editor.getSelectionRect()
    const x = rect ? Math.max(80, Math.min((rect.left + rect.right) / 2 - containerRect.left, containerRect.width - 80)) : containerRect.width / 2
    // Altura estimada do popover (textarea + acoes + head): sem espaco acima,
    // abre abaixo — `.editor-content` tem overflow hidden e clipa o que estoura.
    const above = rect ? rect.top - containerRect.top - 10 : 60
    const flip = above < 220
    setPostitRangeArming(false)
    setPostitPopover({
      postitId: null,
      anchorFrom: editor.getParagraphStartAt(selection.selectionStart) ?? null,
      pendingRange: capture.kind === 'range' ? capture.anchor : null,
      draftText: '',
      draftColor: color,
      x,
      y: flip ? (rect ? rect.bottom - containerRect.top + 10 : 80) : above,
      flip,
      deleteArmed: false,
    })
  }

  /** Clique em um pino ou na bolinha da frase (ou peek por hover): abre o
   * popover de edicao. A faixa (quando resolvida) posiciona o popover sobre
   * a frase; sem ela, cai para o paragrafo (pino/legado). Peek abre sem
   * roubar o foco e semeia o snapshot para o fechamento nao gravar nada. */
  function handlePostitWidgetClick(postitId: string, peek = false) {
    if (postitPeekCloseTimerRef.current !== null) {
      window.clearTimeout(postitPeekCloseTimerRef.current)
      postitPeekCloseTimerRef.current = null
    }
    postitPeekIdRef.current = peek ? postitId : null
    const container = editor.editorContent()
    if (!container) return
    const postit = notePostits.find((item) => item.id === postitId)
    if (!postit) return
    const anchor = postitData?.anchored.find((item) => item.postit.id === postitId)
    const position = anchor?.range?.from ?? anchor?.from ?? null
    const rect = position !== null ? getPostitAnchorRect(position) : null
    const containerRect = container.getBoundingClientRect()
    const x = rect ? Math.max(80, Math.min(rect.left - containerRect.left, containerRect.width - 80)) : containerRect.width / 2
    // Mesmo flip conservador do openPostitPopoverAtSelection: sem ~220px acima,
    // abre abaixo do paragrafo (o container clipa popover acima da borda).
    const above = rect ? rect.top - containerRect.top - 10 : 60
    const flip = above < 220
    setPostitRangeArming(false)
    if (peek) {
      // Previa sem edicao possivel (sem foco): semeia o snapshot para o
      // fechamento nao reescrever nada.
      postitLastCommittedRef.current = {
        id: postitId,
        text: postit.text,
        color: postit.color,
        rangeKey: JSON.stringify(null),
      }
    }
    setPostitPopover({
      postitId,
      anchorFrom: anchor?.from ?? null,
      pendingRange: null,
      peek: peek || undefined,
      draftText: postit.text,
      draftColor: postit.color,
      x,
      y: flip ? (rect ? rect.bottom - containerRect.top + 10 : 80) : above,
      flip,
      deleteArmed: false,
    })
    if (!peek) {
      // Clique apos peek: sem remontar, leva o foco ao texto.
      window.requestAnimationFrame(() => {
        postitPopoverRef.current?.querySelector('textarea')?.focus()
      })
    }
  }

  /** Peek por hover na bolinha: so quando nenhum popover esta aberto (sem
   * brigar com edicao em curso). */
  function openPostitPeek(postitId: string) {
    if (postitPopover) return
    handlePostitWidgetClick(postitId, true)
  }

  /** Agenda o fechamento da previa com tolerancia para atravessar ate o
   * popover (que cancela ao entrar). */
  function schedulePostitPeekClose(postitId: string) {
    if (postitPeekIdRef.current !== postitId) return
    if (postitPeekCloseTimerRef.current !== null) {
      window.clearTimeout(postitPeekCloseTimerRef.current)
    }
    postitPeekCloseTimerRef.current = window.setTimeout(() => {
      postitPeekCloseTimerRef.current = null
      if (postitPeekIdRef.current !== postitId) return
      postitPeekIdRef.current = null
      postitHandlersRef.current?.flush()
      setPostitPopover(null)
      setPostitPopoverSize(null)
      setPostitRangeArming(false)
    }, 150)
  }

  /** Entrar no popover cancela o fechamento agendado (vira interacao). */
  function cancelPostitPeekClose() {
    if (postitPeekCloseTimerRef.current !== null) {
      window.clearTimeout(postitPeekCloseTimerRef.current)
      postitPeekCloseTimerRef.current = null
    }
  }

  /** Retangulo de viewport de uma posicao qualquer do doc (posicao do pino
   * ou inicio da faixa). */
  function getPostitAnchorRect(anchorFrom: number): { top: number; bottom: number; left: number; right: number } | null {
    return editor.getRectAt(anchorFrom) ?? null
  }

  /** Exclusao em dois cliques (arma, depois apaga e fecha). */
  function requestDeletePostit() {
    if (!postitPopover?.postitId) return
    if (!postitPopover.deleteArmed) {
      setPostitPopover((current) => current ? { ...current, deleteArmed: true } : current)
      return
    }
    const result = removeNotePostit(draftContent, postitPopover.postitId)
    if (!result.error) setDraftContent(result.content)
    setPostitPopover(null)
  }

  /** Exclusao direta por id (diálogo de orfaos): devolve o erro ou null. */
  function deletePostitById(postitId: string): string | null {
    const result = removeNotePostit(draftContent, postitId)
    if (result.error) return result.error
    setDraftContent(result.content)
    return null
  }

  /** Texto digitado (limite + desarma exclusao). */
  function updateDraftText(text: string) {
    setPostitPopover((current) => current ? { ...current, draftText: text.slice(0, POSTIT_MAX_CHARS), deleteArmed: false } : current)
  }

  /** Cor do papel (desarma exclusao). */
  function updateDraftColor(color: PostitColor) {
    setPostitPopover((current) => current ? { ...current, draftColor: color, deleteArmed: false } : current)
  }

  /** Itens do menu de postits da nota (navegacao): texto + detalhe da area
   * (citacao) ou estado (sem ancora). */
  const postitMenuItems = useMemo(() => notePostits.map((postit) => {
    const anchored = postitData?.anchored.find((item) => item.postit.id === postit.id)
    const quote = postit.range?.quote ?? ''
    return {
      id: postit.id,
      color: postit.color,
      text: postit.text.trim() ? postit.text.trim() : 'Post-it vazio',
      detail: !anchored ? 'sem âncora' : quote ? `“${quote.length > 40 ? `${quote.slice(0, 40)}…` : quote}”` : null,
      orphan: !anchored,
    }
  }), [notePostits, postitData])

  return {
    postitPopover,
    setPostitPopover,
    postitPopoverRef,
    postitPopoverSize,
    postitRangeArming,
    setPostitRangeArming,
    postitData,
    notePostits,
    postitMenuItems,
    /** Post-its sem ancora (paragrafo e frase falharam): invisiveis no
     * editor ate re-ancorar ou excluir pelo dialogo de orfaos. */
    orphans: postitData?.orphans ?? [],
    closePostitPopover,
    flushPendingPostitSave,
    requestDeletePostit,
    deletePostitById,
    updateDraftText,
    updateDraftColor,
    startPostitPopoverResize,
    openPostitPopoverAtSelection,
    handlePostitWidgetClick,
    openPostitPeek,
    schedulePostitPeekClose,
    cancelPostitPeekClose,
    reanchorPostitToSelection,
  }
}
