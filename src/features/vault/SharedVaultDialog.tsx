import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import './shared-vault-dialog.css'

/**
 * Aviso de **pasta compartilhada**, mostrado no momento de escolher — antes de
 * carregar nota nenhuma, para a pessoa ainda poder recuar.
 *
 * O texto diz as duas metades sem eufemismo: o que passa a ser comum (notas) e o
 * que continua só dela (progresso, metas, dicionário, consumo). O PIN é citado
 * porque é ali que nasce a expectativa errada: ele protege a escolha de perfil,
 * não os arquivos.
 */
export function SharedVaultDialog({
  pasta,
  outros,
  onConfirm,
  onCancel,
}: {
  /** Caminho ou nome da pasta, como aparece na tela de escolha. */
  pasta: string
  outros: string[]
  /** `naoAvisarDeNovo` vale só para esta pasta. */
  onConfirm: (naoAvisarDeNovo: boolean) => void
  onCancel: () => void
}) {
  const [naoAvisar, setNaoAvisar] = useState(false)
  const nomes = new Intl.ListFormat('pt-BR', { type: 'conjunction' }).format(outros)

  return (
    <div className="shared-vault-backdrop" role="presentation">
      <section
        className="shared-vault-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-vault-title"
      >
        <p className="shared-vault-kicker">Pasta já usada</p>
        <h2 id="shared-vault-title">Esta pasta é compartilhada</h2>
        <p className="shared-vault-lead">
          <code>{pasta}</code> já foi aberta por <strong>{nomes}</strong>.
        </p>

        <div className="shared-vault-facts">
          <div>
            <h3>O que passa a ser comum</h3>
            <p>
              Todas as notas e anexos. Quem abre esta pasta vê e edita o mesmo
              conteúdo — inclusive o que você escrever.
            </p>
          </div>
          <div>
            <h3>O que continua só seu</h3>
            <p>
              Histórico de revisão, metas, dicionário, consumo e preferências. A
              revisão do outro não mexe no seu agendamento.
            </p>
          </div>
        </div>

        <p className="shared-vault-note">
          O PIN do perfil protege a escolha de perfil nesta máquina; não protege os
          arquivos da pasta.
        </p>

        <label className="shared-vault-check">
          <input
            type="checkbox"
            checked={naoAvisar}
            onChange={(event) => setNaoAvisar(event.target.checked)}
          />
          <span>Não avisar de novo para esta pasta</span>
        </label>

        <div className="shared-vault-actions">
          <Button type="button" variant="bare" size="md" onClick={onCancel}>
            Escolher outra pasta
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => onConfirm(naoAvisar)}
          >
            Abrir compartilhado
          </Button>
        </div>
      </section>
    </div>
  )
}
