import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { TitleBar } from '../../components/TitleBar'
import { UpdateBanner } from '../../components/UpdateBanner'
import { DevControls } from '../../components/DevControls'
import { GuestProfileStep } from './GuestProfileStep'
import type { IdentitySummary } from '../../lib/identities'
import { AccountForm } from '../account/AccountForm'
import { buildVaultPathPreview, type CreateVaultForm } from '../../lib/vault'
import type { KnownVault } from '../../lib/vaultStartup'
import { markLoginSkipped, readLoginSkipped } from '../../lib/loginGate'
import { disabledSessionClient, useSession, type SessionClient } from '../../lib/session'
import type { AppUpdaterController } from '../../lib/useAppUpdater'
import '../account/login-page.css'
import './vault-welcome.css'

/**
 * Tela de abertura: **conta primeiro, vault depois**.
 *
 * A ordem tem motivo de produto: quem já tem conta entra e o plano/o consumo de
 * IA passam a valer para o vault que abrir em seguida. Quem não quer conta usa
 * "Continuar sem conta" — o passo do vault é idêntico nos dois caminhos, então
 * nenhuma funcionalidade depende de login.
 *
 * O App continua dono dos estados e das ações de vault; esta tela só desenha.
 */
export type VaultSelectionProps = {
  /** Cliente de conta; `null` quando o build não tem Supabase configurado. */
  accountClient: SessionClient | null
  loading: boolean
  status: string
  error: string | null
  chooseExistingVault: () => void
  chooseVaultParent: () => void
  createVault: () => void
  createForm: CreateVaultForm
  setCreateForm: Dispatch<SetStateAction<CreateVaultForm>>
  /** Chamado uma vez, quando a pergunta de conta (entrar ou seguir sem) termina. */
  onAccountSettled?: () => void
  /** Vaults que o app já abriu aqui — a lista é a tela, não um modal por cima. */
  knownVaults: KnownVault[]
  onOpenKnownVault: (path: string) => void
  /**
   * Identidades desta máquina (convidados). Não dependem de qual vault vai
   * abrir: o cartão mora na pasta do app e viaja uma cópia dentro de cada vault.
   */
  guestIdentities: IdentitySummary[] | null
  guestIdentityBusy: boolean
  guestIdentityError: string | null
  /** Devolve `true` quando a identidade foi escolhida e a tela pode seguir. */
  onIdentitySelect: (identity: IdentitySummary, pin?: string) => Promise<boolean>
  onIdentityCreate: (name: string, pin: string | null) => Promise<boolean>
  appUpdater: AppUpdaterController
  isBuilderModeEnabled: boolean
  setBuilderModeEnabled: (enabled: boolean) => void
}

type Step = 'account' | 'guest' | 'vault'

/** Pilares do produto — texto curto, sem promessa que o app não cumpre.
 * Sem numeração: 01/02/03 sugeria uma sequência que não existe. */
const PILLARS = [
  ['Tudo local', 'Notas, anexos e histórico no seu disco.'],
  ['Revisão por retenção', 'Cada nota volta no dia em que você estaria esquecendo.'],
  ['IA quando quiser', 'Modelo no seu computador ou a sua própria chave.'],
] as const

export function VaultSelection({
  accountClient,
  loading,
  status,
  error,
  chooseExistingVault,
  chooseVaultParent,
  createVault,
  createForm,
  setCreateForm,
  onAccountSettled,
  knownVaults,
  onOpenKnownVault,
  guestIdentities,
  guestIdentityBusy,
  guestIdentityError,
  onIdentitySelect,
  onIdentityCreate,
  appUpdater,
  isBuilderModeEnabled,
  setBuilderModeEnabled,
}: VaultSelectionProps) {
  const session = useSession(accountClient ?? disabledSessionClient)
  const [step, setStep] = useState<Step>(() =>
    accountClient && !readLoginSkipped() ? 'account' : 'vault',
  )
  /**
   * Avisa o App quando a pergunta de conta está resolvida, para ele só então
   * decidir sobre o último vault. Antes existia um `escolheuConta` local, e ele
   * era uma **segunda** fonte de verdade: quem já tinha dispensado o login numa
   * sessão anterior caía direto no passo do vault com a flag falsa — e o modal
   * nunca aparecia. Agora `step === 'vault'` é a única resposta para "já
   * respondeu?", e este efeito só traduz isso para quem está acima.
   */
  const avisouContaResolvidaRef = useRef(false)

  // Já logado (ou login acabou de acontecer): o passo da conta não tem o que
  // perguntar, então segue direto para o vault.
  useEffect(() => {
    if (session.snapshot.status === 'auth') setStep('vault')
  }, [session.snapshot.status])

  // Estar no passo do vault **é** a resposta: seja porque a conta já existia,
  // porque o login acabou de acontecer, ou porque o convidado escolheu seguir.
  useEffect(() => {
    if (step !== 'vault' || avisouContaResolvidaRef.current) return
    avisouContaResolvidaRef.current = true
    onAccountSettled?.()
  }, [onAccountSettled, step])

  function skipAccount() {
    markLoginSkipped()
    setStep('vault')
  }

  /**
   * "Continuar sem conta" com perfis já conhecidos: em vez de cair na escolha
   * do vault e só depois perguntar quem está estudando, pergunta aqui — a pessoa
   * já respondeu que não quer conta, e o perfil é a próxima coisa de que o app
   * precisa para abrir o histórico certo.
   */
  function handleGuestSkip() {
    // Lista vazia também conta: significa "nenhuma identidade criada" — e aí a
    // tela certa é a de criação, não a de escolher o vault.
    if (guestIdentities) {
      setStep('guest')
      return
    }
    skipAccount()
  }

  async function escolherPerfil(profile: IdentitySummary, pin?: string) {
    const aberto = await onIdentitySelect(profile, pin)
    if (aberto) {
      markLoginSkipped()
      setStep('vault')
    }
  }

  async function criarPerfil(nome: string, pin: string | null) {
    const aberto = await onIdentityCreate(nome, pin)
    if (aberto) {
      markLoginSkipped()
      setStep('vault')
    }
  }

  return (
    <main className="welcome-shell" data-builder-name="welcome-shell">
      <TitleBar />
      <UpdateBanner updater={appUpdater} />

      <section className="welcome-brand" data-builder-name="welcome-brand">
        <svg className="welcome-orbit" viewBox="0 0 420 420" aria-hidden="true" focusable="false">
          <circle cx="210" cy="210" r="196" />
          <circle cx="210" cy="210" r="132" />
          <circle cx="210" cy="210" r="68" />
          <path d="M210 14 L210 406 M14 210 L406 210" />
          <path d="M72 72 L348 348 M348 72 L72 348" />
        </svg>

        <div className="welcome-brand-copy">
          <p className="welcome-eyebrow">
            <span className="welcome-mark">MM</span>
            MirrorMind
          </p>
          <h1>Concentre o estudo no que você esquece.</h1>
          <p className="welcome-lede">
            Suas notas ficam neste computador. O app decide o que revisar e quando — e nada da sua
            escrita sai daqui sem você pedir.
          </p>

          <ul className="welcome-pillars">
            {PILLARS.map(([titulo, texto]) => (
              <li key={titulo}>
                <strong>{titulo}</strong>
                <em>{texto}</em>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="welcome-panel" data-builder-name="welcome-panel">
        {step === 'account' && accountClient ? (
          <div className="welcome-card">
            <AccountForm
              client={accountClient}
              onAuthenticated={() => setStep('vault')}
              onSkip={handleGuestSkip}
            />
          </div>
        ) : step === 'guest' && guestIdentities ? (
          <div className="welcome-card">
            <GuestProfileStep
              profiles={guestIdentities}
              busy={guestIdentityBusy}
              error={guestIdentityError}
              onSelect={(profile, pin) => void escolherPerfil(profile, pin)}
              onCreate={(nome, pin) => void criarPerfil(nome, pin)}
            />
            <Button
              type="button"
              variant="bare"
              size="sm"
              className="welcome-back"
              onClick={() => setStep('account')}
            >
              Voltar
            </Button>
          </div>
        ) : (
          <div className="welcome-card">
            <h2>Onde ficam suas notas?</h2>
            <p className="login-subtitle">
              Um vault é só uma pasta no seu computador. Você pode abrir uma que já tem ou começar
              uma nova.
            </p>

            {knownVaults.length > 0 ? (
              <div className="welcome-vault-list">
                <p className="welcome-vault-list-label">Vaults neste computador</p>
                {knownVaults.map((vault) => (
                  <button
                    key={vault.path}
                    type="button"
                    className="welcome-vault-row"
                    onClick={() => onOpenKnownVault(vault.path)}
                    disabled={loading}
                  >
                    <span className="welcome-vault-row-name">{vault.name}</span>
                    <span className="welcome-vault-row-path">{vault.path}</span>
                    <span className="welcome-vault-row-open">Abrir</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="welcome-vault-options">
              <article className="welcome-vault-option">
                <div>
                  <h3>Abrir pasta existente</h3>
                  <p>O MirrorMind lê as notas <code>.md</code> que já estão lá.</p>
                </div>
                <Button variant="secondary" size="md" onClick={chooseExistingVault} disabled={loading}>
                  Escolher pasta
                </Button>
              </article>

              <article className="welcome-vault-option welcome-vault-option--accent">
                <div>
                  <h3>Criar um vault novo</h3>
                  <p>A pasta nasce com a estrutura do app pronta.</p>
                </div>
                <div className="welcome-vault-fields">
                  <label className="login-field">
                    <span>Nome do vault</span>
                    <Field
                      size="sm"
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
                  <div className="login-field">
                    <span>Pasta pai</span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={chooseVaultParent}
                      disabled={loading}
                    >
                      {createForm.parentPath ? 'Trocar pasta' : 'Escolher pai'}
                    </Button>
                  </div>
                </div>
                <small className="welcome-path">
                  Vai criar em {buildVaultPathPreview(createForm.parentPath, createForm.name)}
                </small>
                <Button variant="primary" size="md" onClick={createVault} disabled={loading}>
                  Criar vault
                </Button>
              </article>
            </div>

            {error ? <p className="error-banner" role="alert">{error}</p> : null}

            <div className="status-strip" role="status">
              <span className={`status-dot${loading ? ' is-busy' : ''}`}></span>
              <span>{status}</span>
            </div>

            {accountClient && session.snapshot.status !== 'auth' ? (
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="welcome-back"
                onClick={() => setStep('account')}
              >
                Entrar na conta
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <DevControls enabled={isBuilderModeEnabled} onEnabledChange={setBuilderModeEnabled} />
    </main>
  )
}
