import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createOwnedRunRoot, removeOwnedRunRoot } from './run-root.mjs'

const projectRoot = resolve(import.meta.dirname, '../..')
const resultsRoot = resolve(projectRoot, 'test-results/e2e')

// O build E2E usa o identificador `com.mirrormind.desktop.e2e`, mas no Windows
// a APPDATA/LOCALAPPDATA reais vencem os envs do run (Known Folder API): o
// perfil do WebView2 (localStorage) e a preferencia de vault recente acabavam
// na pasta real e vazavam estado entre execucoes (ex.: o "nao perguntar" da
// jornada de configuracoes quebrava as reaberturas seguintes). A limpeza por
// jornada isola o estado; dentro da jornada, as fases compartilham o perfil e
// a preferencia (isolada no runRoot pelo backend) e a persistencia e validada.
function wipeE2eAppState() {
  for (const envKey of ['APPDATA', 'LOCALAPPDATA']) {
    const base = process.env[envKey]
    if (!base) continue
    const target = join(base, 'com.mirrormind.desktop.e2e')
    // O WebView2 da jornada anterior pode segurar o diretorio por alguns
    // instantes apos o fechamento do app; tenta de novo com backoff curto.
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
const journeys = [
  {
    spec: 'tests/e2e/create-save-reopen.e2e.mjs',
    phases: ['create-and-save', 'reopen'],
  },
  {
    spec: 'tests/e2e/rename-move-links.e2e.mjs',
    phases: ['rename-and-move', 'verify-rename-and-move'],
  },
  {
    spec: 'tests/e2e/trash-restore.e2e.mjs',
    phases: ['trash-and-restore', 'verify-trash-restore'],
  },
  {
    spec: 'tests/e2e/external-change-conflict.e2e.mjs',
    phases: ['external-change-conflict', 'verify-external-change'],
  },
  {
    // Vault proprio (runRoot proprio -> appdata limpa, sem dialogo de vault
    // recente): a deteccao automatica de mudanca externa funciona sem Ctrl+S.
    spec: 'tests/e2e/external-change-conflict.e2e.mjs',
    phases: ['automatic-detect'],
  },
  {
    spec: 'tests/e2e/session-abandon.e2e.mjs',
    phases: ['session-abandon'],
  },
  {
    spec: 'tests/e2e/open-obsidian-vault.e2e.mjs',
    phases: ['open-obsidian-vault', 'verify-open-obsidian-vault'],
  },
  {
    spec: 'tests/e2e/safe-failure.e2e.mjs',
    phases: ['safe-failure', 'verify-safe-failure'],
  },
  {
    spec: 'tests/e2e/attachment-complete.e2e.mjs',
    phases: ['attachment-complete', 'verify-attachment'],
  },
  {
    spec: 'tests/e2e/settings-persistence.e2e.mjs',
    phases: ['configure-settings', 'verify-settings-reopen', 'verify-settings-autoload'],
  },
]

// WebView2 demora a liberar o compositor apos o fechamento do app; a pausa
// entre fases reduz as janelas pretas intermitentes no cold-start da fase
// seguinte (flake ambiental observado nas fases de reabertura).
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

async function runJourney({ phases, spec }) {
  wipeE2eAppState()
  const { runRoot, ownerToken } = createOwnedRunRoot(resultsRoot)
  try {
    for (const phase of phases) {
      try {
        await runPhase({ ownerToken, phase, runRoot, spec })
      } catch (firstError) {
        // Fases de verificacao sao idempotentes (reabrem, leem e verificam):
        // uma nova tentativa em processo novo recupera o cold-start perdido
        // (janela preta do WebView2) sem duplicar estado.
        if (!phase.startsWith('verify-')) throw firstError
        console.warn(`E2E phase "${phase}" falhou na 1a tentativa; repetindo uma vez.`)
        await sleep(PHASE_GAP_MS)
        await runPhase({ ownerToken, phase, runRoot, spec })
      }
      await sleep(PHASE_GAP_MS)
    }
  } finally {
    removeOwnedRunRoot(resultsRoot, runRoot, ownerToken)
  }
}

try {
  for (const journey of journeys) {
    await runJourney(journey)
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
