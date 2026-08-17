import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createOwnedRunRoot, removeOwnedRunRoot } from './run-root.mjs'

const projectRoot = resolve(import.meta.dirname, '../..')
const resultsRoot = resolve(projectRoot, 'test-results/e2e')

// O build E2E usa o identificador `com.mirrormind.desktop.e2e`. No Linux o
// estado do app (preferencia de vault, notificacoes e perfil do WebKit) vive
// nos diretorios XDG apontados pelo wdio.conf.mjs para dentro do runRoot; a
// limpeza por jornada isola o estado entre execucoes (equivalente ao APPDATA
// do Windows).
function wipeE2eAppState() {
  const base = process.env.HOME
  if (!base) return
  for (const directory of ['xdg-config', 'xdg-data', 'xdg-cache']) {
    const target = join(base, directory)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        rmSync(target, { recursive: true, force: true })
        break
      } catch {
        if (attempt === 7) throw new Error(`Nao foi possivel limpar o estado E2E em '${target}'.`)
        sleepSync(500)
      }
    }
  }
}

function sleepSync(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) { /* busy wait curto */ }
}

const wdioEntryPoint = resolve(projectRoot, 'node_modules/@wdio/cli/bin/wdio.js')

// Smoke Linux: abre o Vault proprio e salva uma nota — o nucleo da jornada
// critica, sem depender de renomeacao multi-fase nem de WebView2.
const smokeJourneys = [
  {
    spec: 'tests/e2e/create-save-reopen.e2e.mjs',
    phases: ['create-and-save'],
  },
]

const PHASE_GAP_MS = 3_000

async function runPhase({ ownerToken, phase, runRoot, spec }) {
  await new Promise((resolvePhase, rejectPhase) => {
    const child = spawn(
      process.execPath,
      [wdioEntryPoint, 'run', 'wdio.conf.mjs', '--spec', spec],
      {
        cwd: projectRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          MIRRORMIND_E2E_ORCHESTRATED: 'true',
          MIRRORMIND_E2E_OWNER_TOKEN: ownerToken,
          MIRRORMIND_E2E_PHASE: phase,
          MIRRORMIND_E2E_RUN_ROOT: runRoot,
        },
      },
    )

    child.once('error', rejectPhase)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePhase()
        return
      }
      rejectPhase(new Error(`E2E phase "${phase}" failed (code=${code}, signal=${signal ?? 'none'}).`))
    })
  })
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function runSmoke({ phases, spec }) {
  wipeE2eAppState()
  const { runRoot, ownerToken } = createOwnedRunRoot(resultsRoot)
  try {
    for (const phase of phases) {
      await runPhase({ ownerToken, phase, runRoot, spec })
      await sleep(PHASE_GAP_MS)
    }
  } finally {
    removeOwnedRunRoot(resultsRoot, runRoot, ownerToken)
  }
}

try {
  for (const journey of smokeJourneys) {
    await runSmoke(journey)
  }
  console.log('[e2e linux] smoke concluido com sucesso.')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
