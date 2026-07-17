import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createOwnedRunRoot, removeOwnedRunRoot } from './run-root.mjs'

const projectRoot = resolve(import.meta.dirname, '../..')
const resultsRoot = resolve(projectRoot, 'test-results/e2e')
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
]

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

async function runJourney({ phases, spec }) {
  const { runRoot, ownerToken } = createOwnedRunRoot(resultsRoot)
  try {
    for (const phase of phases) {
      await runPhase({ ownerToken, phase, runRoot, spec })
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
