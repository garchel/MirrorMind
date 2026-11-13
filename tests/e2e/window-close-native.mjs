import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  appProcessIds,
  requestWindowCloseFromOs,
  waitForProcessExit,
  waitForWindow,
} from './window-close-os.mjs'

/**
 * E2E nativo do fechamento: o app COMPILADO, a janela REAL, o X DE VERDADE.
 *
 * Roda fora do WebDriver porque o criterio e justamente "a janela sai do
 * sistema": assim que o fechamento acontece, a sessao do driver morre junto e
 * nao sobra onde assertar. Aqui o criterio e o processo: WM_CLOSE enviado, o
 * processo deve desaparecer dentro de FECHAR_MS.
 *
 * Cobre o bug que originou o watchdog: o Tauri 2 so conclui o fechamento quando
 * o webview responde ao `onCloseRequested`. Com o handler pendurado, X, Alt+F4
 * e barra de tarefas paravam de funcionar. Se o watchdog nao existir, este
 * probe falha por timeout em vez de passar — e o unico teste que enxerga isso.
 *
 * HISTORICO DO QUE ESTE TESTE PEGOU (nao remover sem ler):
 *
 * 1. `capabilities/default.json` nao tinha `core:window:allow-destroy`. Com
 *    rascunho limpo, o handler JS nao chama `preventDefault`, o
 *    `@tauri-apps/api` chamava `destroy()` e a chamada era rejeitada em
 *    silencio: WM_CLOSE entregue (PostMessage = true) e processo vivo para
 *    sempre — a janela presa que o watchdog nao cobria, porque o webview
 *    respondia ao ack. Corrigido; hoje fecha em ~210 ms.
 *
 * 2. ABERTO: com a janela destravada, fechar pelo X levando uma nota NOVA
 *    digitada e nao salva encerra o app sem perguntar (o dialogo de "alteracoes
 *    nao salvas" nao aparece). Medido no spec WebDriver que existia aqui
 *    (removido da esteira por causa disso): depois do WM_CLOSE, zero processos
 *    vivos e o texto perdido. O cenario precisa de uma jornada propria, com a
 *    nota comprovadamente suja antes do X.
 */

const FECHAR_MS = 20_000
const JANELA_MS = 60_000
const projectRoot = resolve(import.meta.dirname, '../..')
const appBinary = process.env.MIRRORMIND_E2E_APP_BINARY
  ?? resolve(projectRoot, 'src-tauri/target/debug', process.platform === 'win32' ? 'mirrormind.exe' : 'mirrormind')

function runScenario(nome, { esperarJanelaAssentarMs }) {
  return new Promise((resolveScenario, rejectScenario) => {
    const appDir = mkdtempSync(join(tmpdir(), 'mirrormind-close-'))
    const env = {
      ...process.env,
      APPDATA: join(appDir, 'appdata'),
      LOCALAPPDATA: join(appDir, 'localappdata'),
      XDG_CONFIG_HOME: join(appDir, 'xdg-config'),
      XDG_DATA_HOME: join(appDir, 'xdg-data'),
      XDG_CACHE_HOME: join(appDir, 'xdg-cache'),
      MIRRORMIND_E2E_MOCK_AI: '1',
    }
    const child = spawn(appBinary, [], { env, stdio: 'ignore' })
    let finalizado = false

    const limpar = () => {
      if (finalizado) return
      finalizado = true
      rmSync(appDir, { recursive: true, force: true })
    }

    child.once('error', (error) => {
      limpar()
      rejectScenario(new Error(`[${nome}] nao foi possivel iniciar o app: ${error.message}`))
    })

    void (async () => {
      try {
        const pid = child.pid
        if (!pid) throw new Error(`[${nome}] o app nao informou PID.`)

        const janela = await waitForWindow(pid, JANELA_MS)
        if (janela === null) {
          throw new Error(`[${nome}] a janela nao apareceu em ${JANELA_MS} ms.`)
        }

        if (esperarJanelaAssentarMs > 0) {
          await new Promise((resolveSleep) => setTimeout(resolveSleep, esperarJanelaAssentarMs))
        }

        // O app pode ter aberto um processo filho do WebView2; o WM_CLOSE vai
        // para a janela principal, que pertence ao processo que lancamos.
        const pids = await appProcessIds(appBinary)
        if (!pids.includes(pid)) {
          throw new Error(`[${nome}] o processo lancado (${pid}) nao aparece na lista: ${pids.join(', ')}.`)
        }

        const envio = await requestWindowCloseFromOs(pid)
        if (!envio.includes('ENVIADO')) {
          throw new Error(`[${nome}] WM_CLOSE nao foi entregue (resposta: ${envio}).`)
        }

        const tempo = await waitForProcessExit(pid, FECHAR_MS)
        if (tempo === null) {
          throw new Error(
            `[${nome}] a janela NAO fechou em ${FECHAR_MS} ms depois do WM_CLOSE — `
            + 'e o sintoma do handler de fechamento pendurado (watchdog ausente ou resposta perdida).',
          )
        }

        limpar()
        resolveScenario({ cenario: nome, aberturaMs: janela, fechamentoMs: tempo })
      } catch (error) {
        try {
          child.kill('SIGKILL')
        } catch {
          // processo ja saiu
        }
        limpar()
        rejectScenario(error)
      }
    })()
  })
}

const cenarios = [
  // Fecha assim que a janela existe: a corrida entre o ack e o watchdog.
  ['fechar ao abrir', { esperarJanelaAssentarMs: 0 }],
  // Fecha com o app assentado: o caminho normal de quem trabalha e fecha.
  ['fechar com a janela assentada', { esperarJanelaAssentarMs: 3_000 }],
]

try {
  for (const [nome, opcoes] of cenarios) {
    const resultado = await runScenario(nome, opcoes)
    console.log(
      `OK: ${resultado.cenario} — janela em ${resultado.aberturaMs} ms, `
      + `fechou em ${resultado.fechamentoMs} ms depois do WM_CLOSE.`,
    )
  }
  console.log('E2E do fechamento: 2 cenarios OK.')
} catch (error) {
  console.error(error.message ?? error)
  process.exitCode = 1
}
