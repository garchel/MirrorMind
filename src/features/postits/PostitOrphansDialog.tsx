import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { POSTIT_COLOR_HEX, type NotePostit } from '../../lib/postits'
import { Modal, ModalHeader } from '../../components/Modal'

export type PostitOrphansDialogProps = {
  open: boolean
  orphans: NotePostit[]
  onClose: () => void
  /** Abre o popover do post-it (posicionado no centro; re-ancoravel). */
  onOpen: (postitId: string) => void
  /** Exclui e devolve o erro (ou null). */
  onDelete: (postitId: string) => string | null
}

/** Post-its sem ancora (o paragrafo sumiu e a frase nao resolve): listados
 * para reabrir (e re-ancorar pelo fluxo normal) ou excluir. Sem isso eles
 * seriam invisiveis e impossiveis de recuperar. */
export function PostitOrphansDialog({ open, orphans, onClose, onOpen, onDelete }: PostitOrphansDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // Lista esvaziada (exclusões) fecha sozinho: sem nada a mostrar.
  useEffect(() => {
    if (open && orphans.length === 0) onClose()
  }, [open, orphans.length, onClose])
  return (
    <Modal open={open} onClose={onClose} label="Post-its sem âncora" labelledBy="postit-orphans-title">
      <ModalHeader
        titleId="postit-orphans-title"
        title="Post-its sem âncora"
        kicker={`${orphans.length} ${orphans.length === 1 ? 'esquecido' : 'esquecidos'} na nota`}
        closeLabel="Fechar post-its sem âncora"
        onClose={onClose}
      />
      {error ? <p className="postit-orphans-error" role="alert">{error}</p> : null}
      <ul className="postit-orphans-list">
        {orphans.map((postit) => (
          <li key={postit.id} className="postit-orphans-item">
            <span
              className="postit-orphans-dot"
              style={{ background: POSTIT_COLOR_HEX[postit.color] }}
              aria-hidden="true"
            />
            <span className="postit-orphans-text">
              {postit.text.trim() ? postit.text.trim() : 'Post-it vazio'}
            </span>
            <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => { setError(null); setConfirmId(null); onOpen(postit.id) }}>
              Abrir
            </Button>
            {confirmId === postit.id ? (
              <Button
                type="button"
                className="ui-button ui-button--secondary ui-button--sm"
                onClick={() => {
                  const failure = onDelete(postit.id)
                  if (failure) {
                    setError(failure)
                    return
                  }
                  setError(null)
                  setConfirmId(null)
                }}
              >
                Excluir?
              </Button>
            ) : (
              <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => { setError(null); setConfirmId(postit.id) }}>
                Excluir
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
