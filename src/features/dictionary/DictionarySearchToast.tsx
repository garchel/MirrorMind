import { BookMarked, Loader2, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import './dictionary.css'

/** Em que ponto do pedido o aviso está. */
export type DictionarySearchStatus = 'searching' | 'ready' | 'error'

/**
 * O aviso que acompanha a busca do conceito.
 *
 * ## Por que o modal não abre mais na hora
 *
 * O provider local leva de 5 a 35 segundos. Abrir o modal imediatamente
 * prendia o usuário numa janela bloqueante durante toda a espera: ele não
 * podia continuar lendo a nota, e fechar o modal perdia o pedido. Agora a
 * busca acontece em segundo plano, o aviso conta o que está acontecendo e o
 * botão "Abrir" aparece quando existe algo para revisar.
 *
 * ## Por que o aviso não some sozinho
 *
 * Um aviso que some depois de alguns segundos levaria o botão junto: o
 * usuário voltaria da leitura e não teria como reabrir o resultado. Ele só
 * sai quando o usuário abre o resultado ou dispensa o aviso.
 *
 * ## Por que não há contador de segundos
 *
 * O aviso pode dividir a tela com outros (um por trecho selecionado) e um
 * número mudando a cada segundo chamaria mais atenção que a própria busca.
 * O giro do ícone já diz que o pedido está vivo; o tempo exato só interessa
 * dentro do modal, onde há espaço para ele.
 */
export function DictionarySearchToast({
  term,
  status,
  error,
  onOpen,
  onDismiss,
}: {
  /** O trecho selecionado, como o usuário o vê. */
  term: string
  status: DictionarySearchStatus
  /** Motivo da falha, quando `status` é `error`. */
  error?: string
  onOpen: () => void
  onDismiss: () => void
}) {
  const searching = status === 'searching'
  const failed = status === 'error'
  // O trecho pode ser um paragrafo inteiro: o aviso mostra o comeco do que foi
  // selecionado, nao a selecao toda (que empurraria o botao para fora da tela).
  const MAX_LABEL_CHARS = 60
  const label = term.length > MAX_LABEL_CHARS
    ? `${term.slice(0, MAX_LABEL_CHARS).trimEnd()}…`
    : term

  return (
    <div
      className={`dictionary-search-toast is-${status}`}
      role={failed ? 'alert' : 'status'}
      aria-live={failed ? 'assertive' : 'polite'}
    >
      <div className="dictionary-search-toast-body">
        <div className="dictionary-search-toast-heading">
          {searching ? (
            <Loader2
              className="dictionary-search-toast-spinner"
              size={16}
              aria-hidden="true"
            />
          ) : (
            <BookMarked
              className="dictionary-search-toast-icon"
              size={16}
              aria-hidden="true"
            />
          )}
          <p className="dictionary-search-toast-title">
            {searching
              ? <>Buscando a definição de “{label}”…</>
              : failed
                ? <>Não foi possível buscar a definição de “{label}”.</>
                : <>A definição de “{label}” está pronta.</>}
          </p>
        </div>
        <p className="dictionary-search-toast-hint">
          {searching
            ? 'Você pode continuar lendo a nota; avisamos quando terminar.'
            : failed
              ? error || 'Abra o aviso para ver o motivo e tentar de novo.'
              : 'Revise a definição e confirme antes de gravar no dicionário.'}
        </p>
      </div>
      <div className="dictionary-search-toast-actions">
        {searching ? null : (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onOpen}
          >
            Abrir
          </Button>
        )}
        <button
          type="button"
          className="dictionary-search-toast-close"
          aria-label="Dispensar aviso"
          onClick={onDismiss}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
