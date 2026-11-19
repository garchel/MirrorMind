import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { GoogleMark } from '../../components/ui/GoogleMark'
import { useSession, type SessionClient } from '../../lib/session'

/**
 * Formulário de conta: entrar e criar conta no mesmo lugar.
 *
 * Extraído da página de login para ser o mesmo componente em dois contextos: a
 * rota "Conta" do workspace e a primeira tela do app (antes de escolher o vault).
 * Duas cópias do formulário divergem — uma ganha validação, a outra não.
 */
export function AccountForm({
  client,
  onAuthenticated,
  onSkip,
  autoFocus = true,
}: {
  client: SessionClient
  /** Chamado quando a sessão passa a existir (login ou cadastro). */
  onAuthenticated: () => void
  /** "Continuar sem conta": o app segue funcionando como local. */
  onSkip?: () => void
  autoFocus?: boolean
}) {
  const [mode, setMode] = useState<'entrar' | 'criar'>('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const { snapshot, error, signIn, signUp, signInWithGoogle } = useSession(client)
  const [googleBusy, setGoogleBusy] = useState(false)

  useEffect(() => {
    if (snapshot.status === 'auth') onAuthenticated()
  }, [snapshot.status, onAuthenticated])

  const canSubmit = email.trim().includes('@') && password.length >= 6 && !busy

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    try {
      if (mode === 'criar') await signUp(email.trim(), password)
      else await signIn(email.trim(), password)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="account-form">
      <h2>{mode === 'entrar' ? 'Entrar no MirrorMind' : 'Criar sua conta'}</h2>
      <p className="login-subtitle">
        A conta guarda seu plano e o consumo de IA. Suas notas continuam neste computador —
        o servidor nunca recebe o conteúdo delas.
      </p>

      <div className="settings-segmented login-tabs" role="radiogroup" aria-label="Entrar ou criar conta">
        <Button
          type="button"
          variant="bare"
          size="sm"
          role="radio"
          aria-checked={mode === 'entrar'}
          className={mode === 'entrar' ? 'is-active' : ''}
          onClick={() => setMode('entrar')}
        >
          Já tenho conta
        </Button>
        <Button
          type="button"
          variant="bare"
          size="sm"
          role="radio"
          aria-checked={mode === 'criar'}
          className={mode === 'criar' ? 'is-active' : ''}
          onClick={() => setMode('criar')}
        >
          Criar conta
        </Button>
      </div>

      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <label className="login-field">
          <span>E-mail</span>
          <Field
            size="sm"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@exemplo.com"
            autoComplete="email"
            autoFocus={autoFocus}
            required
          />
        </label>
        <label className="login-field">
          <span>Senha</span>
          <Field
            size="sm"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === 'criar' ? 'Pelo menos 6 caracteres' : 'Sua senha'}
            autoComplete={mode === 'criar' ? 'new-password' : 'current-password'}
            required
          />
        </label>

        {error ? <p className="login-error" role="alert">{error}</p> : null}

        <Button type="submit" variant="primary" size="md" disabled={!canSubmit}>
          {busy ? 'Aguarde…' : mode === 'entrar' ? 'Entrar' : 'Criar conta'}
        </Button>

        {mode === 'criar' ? (
          <p className="login-legal">
            Ao criar a conta você aceita os Termos de uso e a Política de privacidade. A data do
            aceite fica registrada junto da conta.
          </p>
        ) : null}
      </form>

      <div className="login-divider" role="separator"><span>ou</span></div>

      <Button
        type="button"
        variant="secondary"
        size="md"
        className="login-google"
        icon={<GoogleMark />}
        disabled={googleBusy || busy}
        onClick={() => {
          setGoogleBusy(true)
          void signInWithGoogle().finally(() => setGoogleBusy(false))
        }}
      >
        {googleBusy ? 'Abrindo o navegador…' : 'Continuar com o Google'}
      </Button>

      {onSkip ? (
        <>
          <Button type="button" variant="bare" size="sm" className="login-skip" onClick={onSkip}>
            Continuar sem conta
          </Button>
          <p className="login-hint">Notas, revisão local e sua própria chave de IA seguem funcionando.</p>
        </>
      ) : null}
    </div>
  )
}
