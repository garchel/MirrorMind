import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import type { IdentitySummary } from '../../lib/identities'

/**
 * Passo do convidado: quem está estudando neste vault.
 *
 * Aparece quando a pessoa clica em "Continuar sem conta" e a máquina já sabe
 * qual vault vai abrir (a lista de vaults conhecidos tem um só) — nesse caso os
 * perfis daquele vault são lidos **antes** de abrir, e a escolha deixa de ser
 * uma tela surpresa no meio do carregamento.
 *
 * Sem perfil criado a tela pergunta nome e PIN; com perfis, mostra a lista e
 * deixa criar mais um. PIN é conveniência (impede o colega de casa de abrir o
 * perfil), não criptografia de disco — o texto diz isso onde precisa.
 */
export function GuestProfileStep({
  profiles,
  busy,
  error,
  onSelect,
  onCreate,
}: {
  profiles: IdentitySummary[]
  busy: boolean
  error: string | null
  /** `pin` só é usado quando a identidade pede PIN. */
  onSelect: (profile: IdentitySummary, pin?: string) => void
  onCreate: (name: string, pin: string | null) => void
}) {
  // Sem nenhuma identidade criada, a tela já abre pedindo o nome: não há o que
  // escolher, e a pessoa nunca viu esta pergunta antes.
  const [criando, setCriando] = useState(profiles.length === 0)
  const [nome, setNome] = useState('')
  const [pinDoNovo, setPinDoNovo] = useState('')
  const [perfilComPin, setPerfilComPin] = useState<IdentitySummary | null>(null)
  const [pinDigitado, setPinDigitado] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  const nomeLimpo = nome.trim()
  const pinLimpo = pinDoNovo.trim()
  const pinInvalido = pinLimpo.length > 0 && (pinLimpo.length < 4 || pinLimpo.length > 12)

  function criar() {
    setAviso(null)
    if (!nomeLimpo) {
      setAviso('Dê um nome ao perfil.')
      return
    }
    if (pinInvalido) {
      setAviso('O PIN precisa ter de 4 a 12 dígitos.')
      return
    }
    onCreate(nomeLimpo, pinLimpo.length > 0 ? pinLimpo : null)
  }

  function entrar() {
    if (!perfilComPin) return
    onSelect(perfilComPin, pinDigitado)
  }

  return (
    <div className="guest-profile" data-builder-name="guest-profile">
      <h2>{criando ? 'Crie seu perfil' : 'Quem está estudando?'}</h2>
      <p className="login-subtitle">
        {criando
          ? 'O perfil guarda o seu histórico de revisão neste vault. Nada disso sai do computador.'
          : 'Cada perfil tem o seu histórico de revisão. Escolha o seu ou crie outro.'}
      </p>

      {profiles.length > 0 ? (
        <div className="guest-profile-list">
          {profiles.map((profile) => {
            const pedindoPin = perfilComPin?.id === profile.id
            return (
              <div key={profile.id} className="guest-profile-row">
                <div className="guest-profile-meta">
                  <span className="guest-profile-name">{profile.name}</span>
                  <span className="guest-profile-hint">
                    {pedindoPin ? 'Digite o PIN' : profile.hasPin ? 'Pedir PIN' : 'Abrir'}
                  </span>
                </div>
                {pedindoPin ? (
                  <div className="guest-profile-pin">
                    <Field
                      size="sm"
                      type="password"
                      inputMode="numeric"
                      autoFocus
                      value={pinDigitado}
                      onChange={(event) => setPinDigitado(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') entrar()
                      }}
                      placeholder="PIN"
                      aria-label={`PIN do perfil ${profile.name}`}
                    />
                    <Button variant="primary" size="sm" onClick={entrar} disabled={busy}>
                      Entrar
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant={profile.hasPin ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setAviso(null)
                      if (!profile.hasPin) {
                        onSelect(profile)
                        return
                      }
                      setPerfilComPin(profile)
                      setPinDigitado('')
                    }}
                  >
                    {profile.hasPin ? 'Pedir PIN' : 'Entrar'}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      {criando ? (
        <div className="guest-profile-create">
          <label className="login-field">
            <span>Seu nome</span>
            <Field
              size="sm"
              value={nome}
              maxLength={40}
              onChange={(event) => setNome(event.target.value)}
              placeholder="Ex.: Paulo"
            />
          </label>
          <label className="login-field">
            <span>PIN (opcional)</span>
            <Field
              size="sm"
              type="password"
              inputMode="numeric"
              value={pinDoNovo}
              maxLength={12}
              onChange={(event) => setPinDoNovo(event.target.value)}
              placeholder="4 a 12 dígitos"
            />
          </label>
          <small className="guest-profile-note">
            O PIN impede outra pessoa de abrir o seu perfil. Ele não criptografa as notas.
          </small>
          <div className="guest-profile-create-actions">
            <Button variant="primary" size="md" onClick={criar} disabled={busy}>
              Criar perfil
            </Button>
            {profiles.length > 0 ? (
              <Button variant="bare" size="md" onClick={() => setCriando(false)} disabled={busy}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="md" onClick={() => setCriando(true)} disabled={busy}>
          Criar outro perfil
        </Button>
      )}

      {aviso ?? error ? (
        <p className="error-banner" role="alert">
          {aviso ?? error}
        </p>
      ) : null}
    </div>
  )
}
