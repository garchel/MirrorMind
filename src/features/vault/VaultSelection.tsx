import type { Dispatch, SetStateAction } from 'react'
import { TitleBar } from '../../components/TitleBar'
import { UpdateBanner } from '../../components/UpdateBanner'
import { Modal } from '../../components/Modal'
import { BuilderModeControl } from '../../components/BuilderModeControl'
import {
  buildVaultPathPreview,
  type CreateVaultForm,
  type RecentVaultPreference,
} from '../../lib/vault'
import type { AppUpdaterController } from '../../lib/useAppUpdater'

/** Tela de seleção/criação de vault extraída do `App.tsx` (return final,
 * sem vault aberto): mesmos textos e comportamentos. O App continua dono
 * dos estados e ações. */
export type VaultSelectionProps = {
  loading: boolean
  status: string
  error: string | null
  chooseExistingVault: () => void
  chooseVaultParent: () => void
  createVault: () => void
  createForm: CreateVaultForm
  setCreateForm: Dispatch<SetStateAction<CreateVaultForm>>
  showRecentVaultModal: boolean
  recentVaultPreference: RecentVaultPreference | null
  dismissRecentVault: () => void
  confirmRecentVault: () => void
  skipRecentVaultPrompt: boolean
  setSkipRecentVaultPrompt: (skip: boolean) => void
  appUpdater: AppUpdaterController
  isBuilderModeEnabled: boolean
  setBuilderModeEnabled: (enabled: boolean) => void
}

export function VaultSelection({
  loading,
  status,
  error,
  chooseExistingVault,
  chooseVaultParent,
  createVault,
  createForm,
  setCreateForm,
  showRecentVaultModal,
  recentVaultPreference,
  dismissRecentVault,
  confirmRecentVault,
  skipRecentVaultPrompt,
  setSkipRecentVaultPrompt,
  appUpdater,
  isBuilderModeEnabled,
  setBuilderModeEnabled,
}: VaultSelectionProps) {
  return (
    <main className="app-shell vault-selection-shell" data-builder-name="vault-selection-shell">
      <TitleBar />
      <UpdateBanner updater={appUpdater} />
      <aside className="vault-selection-rail" aria-label="MirrorMind" data-builder-name="vault-selection-rail">
        <span className="vault-selection-mark">MM</span>
        <span className="vault-selection-rail-label">Vaults</span>
      </aside>
      <section className="hero-panel">
        <p className="eyebrow">Bem-vindo ao MirrorMind</p>
        <h1>Vault local, notas em Markdown e base pronta para revisar conhecimento.</h1>
        <p className="hero-copy">
          Suas notas são Markdown local — nada vai para servidores.
          Abra um vault (Obsidian incluso) ou crie um.
        </p>
        <div className="status-strip" role="status">
          <span className={`status-dot${loading ? ' is-busy' : ''}`}></span>
          <span>{status}</span>
        </div>
      </section>

      <section className="vault-grid" data-builder-name="vault-selection-actions">
        <article className="action-card">
          <div className="card-header">
            <span className="card-kicker">Vault existente</span>
            <h2>Abrir vault existente</h2>
          </div>
          <p>
            Selecione uma pasta já existente no computador. O app vai reconhecer notas
            <code>.md</code> e detectar se o vault já veio do Obsidian.
          </p>
          <button type="button" onClick={chooseExistingVault} disabled={loading}>
            Escolher pasta
          </button>
        </article>

        <article className="action-card action-card--accent">
          <div className="card-header">
            <span className="card-kicker">Novo vault</span>
            <h2>Criar novo vault</h2>
          </div>
          <p>Crie um vault novo do zero com a estrutura interna do app pronta para uso.</p>
          <label className="field">
            <span>Nome do vault</span>
            <input
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((currentForm) => ({
                  ...currentForm,
                  name: event.target.value,
                }))
              }
              placeholder="Ex.: Vault de Aprendizado"
            />
          </label>
          <div className="field">
            <span>Pasta pai</span>
            <button
              type="button"
              className="secondary-button"
              onClick={chooseVaultParent}
              disabled={loading}
            >
              {createForm.parentPath ? 'Trocar pasta' : 'Escolher pasta pai'}
            </button>
            <small>{buildVaultPathPreview(createForm.parentPath, createForm.name)}</small>
          </div>
          <button type="button" onClick={createVault} disabled={loading}>
            Criar vault
          </button>
        </article>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      {showRecentVaultModal && recentVaultPreference?.lastVaultPath ? (
        <Modal
          open
          onClose={() => void dismissRecentVault()}
          labelledBy="recent-vault-title"
          className="recent-vault-modal"
          builderName="recent-vault-modal"
          dismissable={false}
        >
            <p className="card-kicker">Continuar de onde parou</p>
            <h2 id="recent-vault-title">Usar o ultimo vault?</h2>
            <p>
              O MirrorMind encontrou o vault usado anteriormente em{' '}
              <code>{recentVaultPreference.lastVaultPath}</code>.
            </p>
            <label className="recent-vault-checkbox">
              <input
                type="checkbox"
                checked={skipRecentVaultPrompt}
                onChange={(event) => setSkipRecentVaultPrompt(event.target.checked)}
              />
              <span>Não perguntar novamente e abrir este vault automaticamente.</span>
            </label>
            <div className="recent-vault-actions">
              <button type="button" className="secondary-button" onClick={() => void dismissRecentVault()}>
                Escolher outro vault
              </button>
              <button type="button" onClick={() => void confirmRecentVault()}>
                Usar este vault
              </button>
            </div>
        </Modal>
      ) : null}
      <BuilderModeControl enabled={isBuilderModeEnabled} onEnabledChange={setBuilderModeEnabled} />
    </main>
  )
}
