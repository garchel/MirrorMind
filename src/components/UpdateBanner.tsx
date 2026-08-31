import { RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { AppUpdaterController } from '../lib/useAppUpdater'
import './UpdateBanner.css'

/** Banner de atualizacao disponivel do app. Fixo no canto inferior direito do
 * shell ativo (workspace ou selecao de vault), acima dos overlays comuns.
 * Exibido apenas quando ha uma versao nova para instalar ou durante o
 * download; a verificacao manual nas Configuracoes usa os outros estados do
 * mesmo controller. `onBeforeInstall` salva o rascunho ativo antes de iniciar
 * o download — no Windows o install encerra o app imediatamente. */
export function UpdateBanner({
  updater,
  onBeforeInstall,
}: {
  updater: AppUpdaterController
  onBeforeInstall?: () => Promise<void>
}) {
  const { status, install, dismiss } = updater
  const visible = status.kind === 'available' || status.kind === 'downloading'

  if (!visible) return null

  const isDownloading = status.kind === 'downloading'

  return (
    <aside
      className="update-banner"
      role="status"
      aria-label="Atualização do MirrorMind disponível"
    >
      <div className="update-banner-icon" aria-hidden="true">
        <RefreshCw size={16} strokeWidth={1.8} className={isDownloading ? 'is-spinning' : ''} />
      </div>
      {isDownloading ? (
        <div className="update-banner-body">
          <strong>Baixando atualização… {status.progress}%</strong>
          <div
            className="update-banner-progress"
            role="progressbar"
            aria-valuenow={status.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progresso do download da atualização"
          >
            <span style={{ width: `${status.progress}%` }} />
          </div>
          <small>O app reinicia ao concluir a instalação.</small>
        </div>
      ) : (
        <div className="update-banner-body">
          <strong>
            Nova versão disponível: {status.update.version}
            <span className="update-banner-current"> (você está na {status.update.currentVersion})</span>
          </strong>
          <small>
            Baixa a atualização assinada e instala sobre a versão atual.
          </small>
          <button
            type="button"
            className="update-banner-install"
            onClick={() => void (async () => {
              if (onBeforeInstall) await onBeforeInstall()
              await install()
            })()}
          >
            <ShieldCheck size={14} strokeWidth={1.8} aria-hidden="true" />
            Baixar e instalar
          </button>
        </div>
      )}
      {isDownloading ? null : (
        <button
          type="button"
          className="update-banner-close"
          onClick={dismiss}
          aria-label="Dispensar aviso de atualização"
          title="Dispensar"
        >
          <X size={14} strokeWidth={1.7} aria-hidden="true" />
        </button>
      )}
    </aside>
  )
}
