import { Button } from './ui/Button'
import { Modal } from './Modal'

export type UnsavedChangesDialogProps = {
  open: boolean
  /** Caminhos com alteracoes nao salvas (a nota ativa entra na lista). */
  paths: string[]
  /** Ha uma nota nova (aba sem arquivo) com conteudo no editor. */
  newNote: boolean
  /** Gravacao em andamento: bloqueia as tres acoes. */
  saving?: boolean
  /** Falha ao salvar: o fechamento continua bloqueado. */
  error?: string | null
  onSaveAndQuit: () => void
  onDiscardAndQuit: () => void
  onCancel: () => void
}

/** Quantos caminhos aparecem antes do resumo "e mais N". */
const LIST_LIMIT = 4

/** Guarda de fechamento da janela: o editor salva sozinho por padrao, mas com
 *  o autosave desligado (ou entre a digitacao e o debounce) fechar levava o
 *  rascunho embora sem perguntar. Tres saidas explicitas: salvar, descartar
 *  ou continuar no app. */
export function UnsavedChangesDialog({
  open,
  paths,
  newNote,
  saving = false,
  error = null,
  onSaveAndQuit,
  onDiscardAndQuit,
  onCancel,
}: UnsavedChangesDialogProps) {
  const total = paths.length + (newNote ? 1 : 0)
  const listed = paths.slice(0, LIST_LIMIT)
  const hidden = paths.length - listed.length

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onCancel()
      }}
      labelledBy="unsaved-changes-title"
      className="note-search-modal external-change-modal"
    >
      <div className="move-item-heading">
        <strong id="unsaved-changes-title">
          {total === 1
            ? 'Uma nota tem alterações não salvas'
            : `${total} notas têm alterações não salvas`}
        </strong>
        <span>Fechar o MirrorMind agora descarta o que ainda não foi gravado.</span>
      </div>
      {listed.length > 0 ? (
        <ul className="unsaved-changes-list">
          {listed.map((path) => (
            <li key={path}>{path.replace(/\.md$/i, '')}</li>
          ))}
          {hidden > 0 ? <li className="unsaved-changes-more">e mais {hidden}</li> : null}
        </ul>
      ) : null}
      {newNote ? <p>A nota nova ainda não tem arquivo: salvar cria o arquivo antes de sair.</p> : null}
      {error ? <p className="unsaved-changes-error" role="alert">{error}</p> : null}
      <div className="folder-dialog-actions">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDiscardAndQuit} disabled={saving}>
          Descartar e sair
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={onSaveAndQuit} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar e sair'}
        </Button>
      </div>
    </Modal>
  )
}
