import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import type { SyncConflictCopy } from '../../lib/vault'
import { Modal, ModalHeader } from '../../components/Modal'

const PROVIDER_LABELS: Record<SyncConflictCopy['provider'], string> = {
  syncthing: 'Syncthing',
  cloud: 'nuvem',
}

export type SyncConflictsDialogProps = {
  open: boolean
  copies: SyncConflictCopy[]
  /** A nota original existe no inventario? */
  hasOriginal: (originalPath: string) => boolean
  onClose: () => void
  onOpen: (relativePath: string) => void
  /** Substitui o original pelo conteudo da copia (e manda a copia para a lixeira). */
  onPromote: (copy: SyncConflictCopy) => Promise<string | null>
  /** Manda a copia para a lixeira (fluxo padrao de exclusao). */
  onDelete: (copy: SyncConflictCopy) => void
}

/** Copias de conflito de sincronizacao (OneDrive/Dropbox/Syncthing): nao
 * entram no inventario de notas para nao poluir explorador, grafo e
 * autocomplete — resolvem-se aqui, com a lixeira como rede de seguranca. */
export function SyncConflictsDialog({ open, copies, hasOriginal, onClose, onOpen, onPromote, onDelete }: SyncConflictsDialogProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Lista esvaziada fecha sozinho: sem nada a resolver.
  useEffect(() => {
    if (open && copies.length === 0) onClose()
  }, [open, copies.length, onClose])

  async function promote(copy: SyncConflictCopy) {
    setBusyId(copy.relativePath)
    setError(null)
    try {
      const failure = await onPromote(copy)
      if (failure) setError(failure)
      else setConfirmId(null)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} label="Cópias de conflito de sincronização" labelledBy="sync-conflicts-title" className="sync-conflicts-modal">
      <ModalHeader
        titleId="sync-conflicts-title"
        title="Cópias de conflito"
        kicker={`${copies.length} ${copies.length === 1 ? 'arquivo ignorado' : 'arquivos ignorados'} no inventário`}
        closeLabel="Fechar cópias de conflito"
        onClose={onClose}
      />
      <p className="sync-conflicts-lead">
        A nuvem guardou uma versão paralela e o app a escondeu das notas para não duplicar links e grafo.
      </p>
      <p className="sync-conflicts-lead">
        Cópias do tipo nome-PC do OneDrive não são detectadas automaticamente.
      </p>
      {error ? <p className="sync-conflicts-error" role="alert">{error}</p> : null}
      <ul className="sync-conflicts-list">
        {copies.map((copy) => {
          const originalMissing = !hasOriginal(copy.originalPath)
          return (
            <li key={copy.relativePath} className="sync-conflicts-item">
              <div className="sync-conflicts-copy">
                <strong>{copy.relativePath.split('/').at(-1)}</strong>
                <small>
                  de {copy.originalPath} · via {PROVIDER_LABELS[copy.provider]}
                  {originalMissing ? ' · original ausente' : ''}
                </small>
              </div>
              <div className="sync-conflicts-actions">
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => onOpen(copy.originalPath)} disabled={originalMissing}>
                  Abrir original
                </Button>
                <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => onOpen(copy.relativePath)}>
                  Abrir cópia
                </Button>
                {confirmId === copy.relativePath ? (
                  <Button
                    type="button"
                    className="ui-button ui-button--secondary ui-button--sm"
                    disabled={busyId !== null || originalMissing}
                    onClick={() => void promote(copy)}
                  >
                    {busyId === copy.relativePath ? 'Substituindo…' : 'Confirmar substituição'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    className="ui-button ui-button--secondary ui-button--sm"
                    disabled={originalMissing}
                    onClick={() => { setError(null); setConfirmId(copy.relativePath) }}
                  >
                    Substituir
                  </Button>
                )}
                <Button
                  type="button"
                  className="ui-button ui-button--secondary ui-button--sm"
                  onClick={() => onDelete(copy)}
                >
                  Excluir cópia
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
