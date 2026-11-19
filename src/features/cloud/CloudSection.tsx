import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { supabaseConfigFromEnv } from '../../lib/supabaseSession'
import {
  formatBytes,
  formatLastSync,
  linkVault,
  readCloudStatus,
  reportCount,
  summarizeReport,
  syncNow,
  unlinkVault,
  type CloudReport,
  type CloudStatus,
} from '../../lib/cloudSync'
import { errorMessage } from '../../lib/tauri'
import './cloud-section.css'

/** Nuvem (add-on): ligar este vault a conta, sincronizar e desligar.
 *
 * A regra que a tela protege: **nada é escolhido no escuro**. Quando ja existem
 * notas aqui e um vault com arquivos na conta, o primeiro clique nao liga nada —
 * ele abre a escolha entre "manter os dois" e "juntar". Depois de ligado, o motor
 * resolve sozinho (conflito vira cópia, nada e sobrescrito calado). */
export function CloudSection({
  vaultPath,
  config,
  deps = { readCloudStatus, linkVault, unlinkVault, syncNow },
}: {
  vaultPath: string
  config?: { url: string; apiKey: string } | null
  deps?: {
    readCloudStatus: typeof readCloudStatus
    linkVault: typeof linkVault
    unlinkVault: typeof unlinkVault
    syncNow: typeof syncNow
  }
}) {
  // A config vem do ambiente, uma vez: recriar o objeto a cada render faria o
  // efeito de carga rodar sem parar (o objeto muda de identidade, não de valor).
  const envConfig = useMemo(() => supabaseConfigFromEnv(), [])
  const resolvedConfig = config === undefined ? envConfig : config

  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [report, setReport] = useState<CloudReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'status' | 'link' | 'sync' | 'unlink' | null>('status')
  const [escolhendo, setEscolhendo] = useState(false)

  const load = useCallback(async () => {
    if (!resolvedConfig) return
    setBusy('status')
    setError(null)
    try {
      setStatus(await deps.readCloudStatus({ path: vaultPath, ...resolvedConfig }))
    } catch (problema) {
      setError(errorMessage(problema, 'Não foi possível falar com a nuvem.'))
    } finally {
      setBusy(null)
    }
  }, [deps, resolvedConfig, vaultPath])

  useEffect(() => {
    void load()
  }, [load])

  async function ligar(strategy: 'merge' | 'separate') {
    if (!resolvedConfig) return
    setBusy('link')
    setError(null)
    setEscolhendo(false)
    try {
      const novo = await deps.linkVault({ path: vaultPath, ...resolvedConfig }, strategy)
      setStatus(novo)
      setReport(null)
    } catch (problema) {
      setError(errorMessage(problema, 'Não foi possível falar com a nuvem.'))
    } finally {
      setBusy(null)
    }
  }

  async function sincronizar() {
    if (!resolvedConfig) return
    setBusy('sync')
    setError(null)
    try {
      const resultado = await deps.syncNow({ path: vaultPath, ...resolvedConfig })
      setReport(resultado)
      setStatus(await deps.readCloudStatus({ path: vaultPath, ...resolvedConfig }))
    } catch (problema) {
      setError(errorMessage(problema, 'Não foi possível falar com a nuvem.'))
    } finally {
      setBusy(null)
    }
  }

  async function desligar() {
    setBusy('unlink')
    setError(null)
    try {
      setStatus(await deps.unlinkVault(vaultPath))
      setReport(null)
    } catch (problema) {
      setError(errorMessage(problema, 'Não foi possível falar com a nuvem.'))
    } finally {
      setBusy(null)
    }
  }

  if (!resolvedConfig) {
    return (
      <div className="cloud-block" data-cloud="sem-configuracao">
        <p className="cloud-hint">
          A nuvem precisa da configuração do servidor neste build. O resto do app
          funciona normalmente sem ela.
        </p>
      </div>
    )
  }

  if (!status || busy === 'status') {
    return (
      <div className="cloud-block" data-cloud="carregando" role="status">
        <p className="cloud-hint">Verificando o estado da sua nuvem…</p>
      </div>
    )
  }

  if (!status.signedIn) {
    return (
      <div className="cloud-block" data-cloud="sem-conta">
        <p className="cloud-hint">
          A nuvem é um complemento da conta: entre na sua conta para ligar este
          vault e estudar em mais de um computador. Tudo o que é local continua
          funcionando sem conta.
        </p>
      </div>
    )
  }

  if (!status.linked) {
    return (
      <div className="cloud-block" data-cloud="desligado">
        <div className="cloud-summary">
          <p>
            <strong>{status.vaultName}</strong> ainda não está na nuvem.{' '}
            {status.localFiles > 0
              ? `${status.localFiles} arquivo(s) daqui podem subir.`
              : 'Este vault ainda não tem arquivos.'}
          </p>
        </div>

        {escolhendo ? (
          <div className="cloud-choice" role="group" aria-label="Como ligar este vault">
            <p className="cloud-choice-title">
              Sua conta já tem dados na nuvem. Como você quer começar?
            </p>
            <ul className="cloud-choice-list">
              {status.accountVaults
                .filter((vault) => vault.files > 0)
                .map((vault) => (
                  <li key={vault.id}>
                    <strong>{vault.name}</strong> — {vault.files} arquivo(s)
                  </li>
                ))}
            </ul>
            <div className="cloud-choice-actions">
              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={busy === 'link'}
                onClick={() => void ligar('separate')}
              >
                Manter os dois
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={busy === 'link'}
                onClick={() => void ligar('merge')}
              >
                Juntar neste vault
              </Button>
            </div>
            <p className="cloud-hint">
              <strong>Manter os dois</strong> cria um vault novo na nuvem só para
              esta pasta — nada é misturado. <strong>Juntar</strong> trata como o
              mesmo vault: o que mudou dos dois lados vira uma cópia marcada
              “conflito”, nunca uma escolha automática.
            </p>
          </div>
        ) : (
          <div className="cloud-actions">
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={busy === 'link'}
              onClick={() => {
                if (status.needsChoice) setEscolhendo(true)
                else void ligar('merge')
              }}
            >
              {busy === 'link' ? 'Ligando…' : 'Ligar este vault à nuvem'}
            </Button>
            <p className="cloud-hint">
              Depois de ligado, o app compara arquivo por arquivo pelo conteúdo
              (não pela data) e só envia o que mudou.
            </p>
          </div>
        )}

        {error && (
          <p className="cloud-error" role="alert">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="cloud-block" data-cloud="ligado">
      <div className="cloud-summary">
        <p>
          <strong>{status.vaultName}</strong> está na nuvem com{' '}
          {status.remoteFiles ?? 0} arquivo(s).{' '}
          {status.localFiles} arquivo(s) aqui.
        </p>
      </div>

      <div className="cloud-actions">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={busy === 'sync'}
          onClick={() => void sincronizar()}
        >
          {busy === 'sync' ? 'Sincronizando…' : 'Sincronizar agora'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={busy === 'unlink' || busy === 'sync'}
          onClick={() => void desligar()}
        >
          Desligar
        </Button>
      </div>

      {report && (
        <div className="cloud-report" role="status">
          <p>{summarizeReport(report)}</p>
          {reportCount(report) > 0 && (
            <p className="cloud-hint">
              Enviado {formatBytes(report.bytesUp)} · recebido{' '}
              {formatBytes(report.bytesDown)}
            </p>
          )}
          {report.conflicts.length > 0 && (
            <p className="cloud-note">
              As versões que divergiram ficaram ao lado da sua, com “conflito” no
              nome. Nada foi sobrescrito.
            </p>
          )}
          {report.failed.length > 0 && (
            <ul className="cloud-failures">
              {report.failed.map((item) => (
                <li key={item.path}>
                  <code>{item.path}</code> — {item.reason}
                </li>
              ))}
            </ul>
          )}
          {report.skipped.length > 0 && (
            <p className="cloud-note">
              Acima de 25 MB por arquivo fica só neste computador:{' '}
              {report.skipped.join(', ')}.
            </p>
          )}
        </div>
      )}

      <p className="cloud-hint">
        Sincroniza sozinho ao abrir o vault e alguns segundos depois de salvar.
        Última sincronização: {formatLastSync(status.lastSyncedAt)}. O conteúdo das
        notas é enviado para a nuvem quando você sincroniza; tudo o que é local
        continua funcionando sem conta.
      </p>

      {error && (
        <p className="cloud-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
