import type { ProfileClient, ProfileSummary } from '../../lib/profiles'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { writeLastProfileId } from '../../lib/profiles'
import './profile-gate.css'

/**
 * "Quem está usando este vault?" — a tela que separa duas pessoas (ou dois
 * "eus") no mesmo computador.
 *
 * Por que ela existe: o histórico de revisão mora na pasta do vault, então sem
 * perfil duas pessoas dividiriam o mesmo aprendizado. Quem usa sozinho e sem PIN
 * nunca vê esta tela: ela só aparece quando há escolha de verdade a fazer.
 *
 * A criação é offline e imediata — nada aqui fala com o servidor. Conta é outra
 * coisa, e continua opcional.
 */
export function ProfileGate({
  vaultRoot,
  client,
  initialProfiles,
  onReady,
  onCancel,
}: {
  vaultRoot: string
  client: ProfileClient
  initialProfiles: ProfileSummary[]
  /** Chamado quando um perfil foi escolhido e marcado como ativo. */
  onReady: (profile: ProfileSummary) => void
  /** Só existe quando há um vault já aberto por trás (troca de perfil). */
  onCancel?: () => void
}) {
  const [profiles, setProfiles] = useState(initialProfiles)
  const [criando, setCriando] = useState(initialProfiles.length === 0)
  const [gerenciando, setGerenciando] = useState(false)
  const [pedindoPin, setPedindoPin] = useState<ProfileSummary | null>(null)
  const [nome, setNome] = useState('')
  const [pin, setPin] = useState('')
  const [pinDoNovo, setPinDoNovo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [podeForcar, setPodeForcar] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    setProfiles(initialProfiles)
  }, [initialProfiles])

  async function entrar(profile: ProfileSummary, pinInformado?: string, force = false) {
    setErro(null)
    setPodeForcar(false)
    setOcupado(true)
    try {
      if (profile.hasPin && pinInformado === undefined) {
        setPedindoPin(profile)
        return
      }
      if (profile.hasPin) {
        const ok = await client.verifyPin(vaultRoot, profile.id, pinInformado ?? '')
        if (!ok) {
          setErro('PIN incorreto.')
          return
        }
      }
      await client.select(vaultRoot, profile.id, { force })
      writeLastProfileId(vaultRoot, profile.id)
      onReady(profile)
    } catch (causa) {
      const texto = mensagem(causa, 'Não foi possível abrir este perfil.')
      setErro(texto)
      // "Aberto em outra janela" é o único erro que a pessoa pode resolver sozinha.
      setPodeForcar(/outra janela/i.test(texto))
    } finally {
      setOcupado(false)
    }
  }

  async function criar() {
    setErro(null)
    setOcupado(true)
    try {
      const criado = await client.create(vaultRoot, {
        name: nome,
        color: 'sage',
        pin: pinDoNovo.trim() ? pinDoNovo.trim() : null,
      })
      setProfiles((atuais) => [...atuais, criado])
      setNome('')
      setPinDoNovo('')
      setCriando(false)
      await entrar(criado)
    } catch (causa) {
      setErro(mensagem(causa, 'Não foi possível criar o perfil.'))
    } finally {
      setOcupado(false)
    }
  }

  async function salvarNome(profile: ProfileSummary, novoNome: string) {
    setErro(null)
    try {
      const atualizado = await client.rename(vaultRoot, profile.id, {
        name: novoNome,
        color: profile.color,
      })
      setProfiles((atuais) => atuais.map((p) => (p.id === profile.id ? atualizado : p)))
    } catch (causa) {
      setErro(mensagem(causa, 'Não foi possível renomear o perfil.'))
    }
  }

  async function excluir(profile: ProfileSummary) {
    setErro(null)
    try {
      await client.remove(vaultRoot, profile.id)
      setProfiles((atuais) => atuais.filter((p) => p.id !== profile.id))
    } catch (causa) {
      setErro(mensagem(causa, 'Não foi possível excluir o perfil.'))
    }
  }

  if (pedindoPin) {
    return (
      <main className="profile-gate" data-builder-name="profile-gate">
        <div className="profile-gate-card">
          <p className="card-kicker">Perfil protegido</p>
          <h1>Digite o PIN de {pedindoPin.name}</h1>
          <p className="profile-gate-lede">
            O PIN impede outra pessoa neste computador de abrir o seu histórico.
          </p>
          <form
            className="profile-gate-form"
            onSubmit={(event) => {
              event.preventDefault()
              void entrar(pedindoPin, pin)
            }}
          >
            <label className="login-field">
              <span>PIN</span>
              <Field
                size="md"
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="4 a 12 dígitos"
              />
            </label>
            {erro ? <p className="login-error" role="alert">{erro}</p> : null}
            <div className="profile-gate-actions">
              <Button
                type="button"
                variant="bare"
                size="md"
                onClick={() => {
                  setPedindoPin(null)
                  setPin('')
                  setErro(null)
                }}
              >
                Voltar
              </Button>
              {podeForcar ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => void entrar(pedindoPin, pin, true)}
                >
                  Continuar mesmo assim
                </Button>
              ) : null}
              <Button type="submit" variant="primary" size="md" disabled={ocupado || pin.length < 4}>
                Abrir perfil
              </Button>
            </div>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main className="profile-gate" data-builder-name="profile-gate">
      <div className="profile-gate-card">
        <p className="card-kicker">Vault</p>
        <h1>Quem está usando este vault?</h1>
        <p className="profile-gate-lede">
          Cada pessoa tem o próprio histórico de revisão. As notas são as mesmas — o que muda é
          quem estudou o quê.
        </p>

        {gerenciando ? (
          <ul className="profile-gate-list">
            {profiles.map((profile) => (
              <li key={profile.id} className="profile-gate-manage">
                <Field
                  size="sm"
                  defaultValue={profile.name}
                  aria-label={`Nome do perfil ${profile.name}`}
                  onBlur={(event) => {
                    const valor = event.target.value.trim()
                    if (valor && valor !== profile.name) void salvarNome(profile, valor)
                  }}
                />
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={profiles.length <= 1}
                  onClick={() => void excluir(profile)}
                >
                  Excluir
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="profile-gate-list">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <button
                  type="button"
                  className="profile-gate-item"
                  data-color={profile.color}
                  disabled={ocupado}
                  onClick={() => void entrar(profile)}
                >
                  <span className="profile-gate-avatar" aria-hidden="true">
                    {iniciais(profile.name)}
                  </span>
                  <span className="profile-gate-name">{profile.name}</span>
                  {profile.hasPin ? <span className="profile-gate-lock">PIN</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}

        {criando ? (
          <form
            className="profile-gate-form"
            onSubmit={(event) => {
              event.preventDefault()
              void criar()
            }}
          >
            <label className="login-field">
              <span>Nome do novo perfil</span>
              <Field
                size="md"
                autoFocus
                value={nome}
                onChange={(event) => setNome(event.target.value)}
                placeholder="Ex.: Maria"
              />
            </label>
            <label className="login-field">
              <span>PIN (opcional)</span>
              <Field
                size="md"
                type="password"
                inputMode="numeric"
                value={pinDoNovo}
                onChange={(event) =>
                  setPinDoNovo(event.target.value.replace(/\D/g, '').slice(0, 12))
                }
                placeholder="Deixe vazio para abrir sem PIN"
              />
            </label>
            {erro ? <p className="login-error" role="alert">{erro}</p> : null}
            <div className="profile-gate-actions">
              {profiles.length > 0 ? (
                <Button type="button" variant="bare" size="md" onClick={() => setCriando(false)}>
                  Cancelar
                </Button>
              ) : null}
              <Button type="submit" variant="primary" size="md" disabled={ocupado || !nome.trim()}>
                Criar e entrar
              </Button>
            </div>
          </form>
        ) : (
          <div className="profile-gate-tools">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => setCriando(true)}
            >
              Novo perfil neste computador
            </Button>
            <Button
              type="button"
              variant="bare"
              size="sm"
              onClick={() => {
                setErro(null)
                setGerenciando((atual) => !atual)
              }}
            >
              {gerenciando ? 'Concluir' : 'Gerenciar perfis'}
            </Button>
          </div>
        )}

        {criando ? null : erro ? <p className="login-error" role="alert">{erro}</p> : null}

        {/* Um perfil aberto em outra janela: seguir é escolha de quem está aqui. */}
        {!criando && podeForcar && profiles.length === 1 ? (
          <Button
            type="button"
            variant="bare"
            size="sm"
            onClick={() => void entrar(profiles[0], undefined, true)}
          >
            Continuar mesmo assim
          </Button>
        ) : null}

        {onCancel ? (
          <Button type="button" variant="bare" size="sm" className="profile-gate-cancel" onClick={onCancel}>
            Voltar para as notas
          </Button>
        ) : null}
      </div>
    </main>
  )
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

function mensagem(causa: unknown, padrao: string): string {
  if (causa instanceof Error && causa.message) return causa.message
  if (typeof causa === 'string' && causa.trim()) return causa
  return padrao
}
