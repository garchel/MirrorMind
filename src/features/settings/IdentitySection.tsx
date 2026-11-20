import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { SettingRow } from './SettingRow'
import { createIdentityClient, type IdentityClient, type IdentitySummary } from '../../lib/identities'
import './identity-section.css'

/**
 * Perfil local: nome e PIN da pessoa, independentes do vault aberto.
 *
 * Antes só dava para renomear/trocar PIN dentro de um vault, pelo portão de
 * perfis — o que fazia a identidade depender de abrir a pasta certa. Aqui ela tem
 * casa própria: o que muda aqui vale para todos os vaults desta máquina e viaja
 * na cópia que fica dentro de cada pasta.
 */
export function IdentitySection({ client }: { client?: IdentityClient } = {}) {
  const api = useMemo(() => client ?? createIdentityClient(invoke), [client])
  const [identidades, setIdentidades] = useState<IdentitySummary[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [edicao, setEdicao] = useState<{ id: string; campo: 'nome' | 'pin' } | null>(null)
  const [nomeNovo, setNomeNovo] = useState('')
  const [pinAtual, setPinAtual] = useState('')
  const [pinNovo, setPinNovo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let ativo = true
    void api
      .list()
      .then((lista) => {
        if (ativo) setIdentidades(lista)
      })
      .catch((causa: unknown) => {
        if (ativo) setErro(mensagem(causa, 'Não foi possível ler os perfis desta máquina.'))
      })
    return () => {
      ativo = false
    }
  }, [api])

  function começar(identidade: IdentitySummary, campo: 'nome' | 'pin') {
    setErro(null)
    setEdicao({ id: identidade.id, campo })
    setNomeNovo(identidade.name)
    setPinAtual('')
    setPinNovo('')
  }

  function cancelar() {
    setEdicao(null)
    setNomeNovo('')
    setPinAtual('')
    setPinNovo('')
  }

  function aplicar(atualizada: IdentitySummary) {
    setIdentidades((lista) =>
      (lista ?? []).map((item) => (item.id === atualizada.id ? atualizada : item)),
    )
    cancelar()
  }

  async function salvarNome(identidade: IdentitySummary) {
    const nome = nomeNovo.trim()
    if (!nome) {
      setErro('O perfil precisa de um nome.')
      return
    }
    setOcupado(true)
    setErro(null)
    try {
      aplicar(await api.rename(identidade.id, nome, identidade.color))
    } catch (causa) {
      setErro(mensagem(causa, 'Não foi possível renomear o perfil.'))
    } finally {
      setOcupado(false)
    }
  }

  async function salvarPin(identidade: IdentitySummary, remover = false) {
    setOcupado(true)
    setErro(null)
    try {
      // Com PIN já definido, o atual é conferido antes: trocar a proteção de
      // alguém sem saber a atual seria o mesmo que não ter proteção.
      if (identidade.hasPin && !remover) {
        const correto = await api.verifyPin(identidade.id, pinAtual)
        if (!correto) {
          setErro('PIN atual incorreto.')
          return
        }
      }
      const novo = remover ? null : pinNovo.trim()
      if (!remover && novo && !/^\d{4,12}$/.test(novo)) {
        setErro('O PIN precisa ter de 4 a 12 dígitos.')
        return
      }
      aplicar(await api.setPin(identidade.id, novo && novo.length > 0 ? novo : null))
    } catch (causa) {
      setErro(mensagem(causa, 'Não foi possível alterar o PIN.'))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="identity-section">
      {identidades === null ? (
        <p className="settings-note">Lendo perfis desta máquina…</p>
      ) : identidades.length === 0 ? (
        <p className="settings-note">
          Nenhum perfil criado ainda. Ele nasce na abertura do app, em “Continuar sem conta”.
        </p>
      ) : (
        identidades.map((identidade) => (
          <div key={identidade.id} className="identity-row">
            <SettingRow
              label={identidade.name}
              description={
                identidade.hasPin
                  ? 'PIN ativo — pedido ao abrir o app. Vale em todos os vaults desta máquina.'
                  : 'Sem PIN — abre direto. Vale em todos os vaults desta máquina.'
              }
              keywords="perfil identidade convidado nome pin senha"
            >
              <div className="identity-actions">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => começar(identidade, 'nome')}
                  disabled={ocupado}
                >
                  Renomear
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => começar(identidade, 'pin')}
                  disabled={ocupado}
                >
                  {identidade.hasPin ? 'Trocar PIN' : 'Definir PIN'}
                </Button>
                {identidade.hasPin ? (
                  <Button
                    type="button"
                    variant="bare"
                    size="sm"
                    onClick={() => void salvarPin(identidade, true)}
                    disabled={ocupado}
                  >
                    Remover PIN
                  </Button>
                ) : null}
              </div>
            </SettingRow>

            {edicao?.id === identidade.id && edicao.campo === 'nome' ? (
              <div className="identity-edit">
                <Field
                  size="sm"
                  value={nomeNovo}
                  maxLength={40}
                  aria-label="Novo nome do perfil"
                  onChange={(event) => setNomeNovo(event.target.value)}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void salvarNome(identidade)}
                  disabled={ocupado}
                >
                  Salvar nome
                </Button>
                <Button variant="bare" size="sm" onClick={cancelar} disabled={ocupado}>
                  Cancelar
                </Button>
              </div>
            ) : null}

            {edicao?.id === identidade.id && edicao.campo === 'pin' ? (
              <div className="identity-edit">
                {identidade.hasPin ? (
                  <Field
                    size="sm"
                    type="password"
                    inputMode="numeric"
                    value={pinAtual}
                    placeholder="PIN atual"
                    aria-label="PIN atual"
                    onChange={(event) => setPinAtual(event.target.value)}
                  />
                ) : null}
                <Field
                  size="sm"
                  type="password"
                  inputMode="numeric"
                  value={pinNovo}
                  maxLength={12}
                  placeholder="Novo PIN (4 a 12 dígitos)"
                  aria-label="Novo PIN"
                  onChange={(event) => setPinNovo(event.target.value)}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void salvarPin(identidade)}
                  disabled={ocupado}
                >
                  Salvar PIN
                </Button>
                <Button variant="bare" size="sm" onClick={cancelar} disabled={ocupado}>
                  Cancelar
                </Button>
              </div>
            ) : null}
          </div>
        ))
      )}

      {erro ? (
        <p className="error-banner" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  )
}

function mensagem(causa: unknown, padrao: string) {
  if (typeof causa === 'string' && causa.trim()) return causa
  if (causa instanceof Error && causa.message) return causa.message
  return padrao
}
