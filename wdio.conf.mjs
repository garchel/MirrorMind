import { browser } from '@wdio/globals'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createOwnedRunRoot, removeOwnedRunRoot, validateOwnedRunRoot } from './tests/e2e/run-root.mjs'

const resultsRoot = resolve('test-results/e2e')
mkdirSync(resultsRoot, { recursive: true })

const ownedRun = process.env.MIRRORMIND_E2E_RUN_ROOT
  ? {
      runRoot: validateOwnedRunRoot(
        resultsRoot,
        process.env.MIRRORMIND_E2E_RUN_ROOT,
        process.env.MIRRORMIND_E2E_OWNER_TOKEN,
      ),
      ownerToken: process.env.MIRRORMIND_E2E_OWNER_TOKEN,
    }
  : createOwnedRunRoot(resultsRoot)
const { runRoot, ownerToken } = ownedRun
const phase = process.env.MIRRORMIND_E2E_PHASE ?? 'single'
if (!['create-and-save', 'reopen', 'rename-and-move', 'verify-rename-and-move', 'single'].includes(phase)) throw new Error(`Unexpected E2E phase: ${phase}`)
const vaultParent = join(runRoot, 'vault-parent')
const appData = join(runRoot, 'appdata')
const localAppData = join(runRoot, 'localappdata')
const artifactsRoot = join(resultsRoot, 'artifacts', phase)
const embeddedPort = Number(process.env.MIRRORMIND_E2E_PORT ?? 4445 + (process.pid % 1000))
const appBinary = resolve('src-tauri/target/debug/mirrormind.exe')

for (const directory of [vaultParent, appData, localAppData, artifactsRoot]) {
  mkdirSync(directory, { recursive: true })
}

process.env.MIRRORMIND_E2E_RUN_ROOT = runRoot
process.env.MIRRORMIND_E2E_OWNER_TOKEN = ownerToken
process.env.MIRRORMIND_E2E_VAULT_PARENT = vaultParent
process.env.MIRRORMIND_E2E_PORT = String(embeddedPort)
process.env.APPDATA = appData
process.env.LOCALAPPDATA = localAppData

function safeArtifactName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'e2e-failure'
}

function inventoryTree(root, limit = 2_000) {
  const entries = []
  const errors = []
  let truncated = false

  const visit = (directory) => {
    let names
    try {
      names = readdirSync(directory)
    } catch (error) {
      errors.push({ path: relative(root, directory), code: error?.code ?? 'UNKNOWN' })
      return
    }

    for (const name of names) {
      if (entries.length >= limit) {
        truncated = true
        return
      }

      const fullPath = join(directory, name)
      let metadata
      try {
        metadata = lstatSync(fullPath)
      } catch (error) {
        errors.push({ path: relative(root, fullPath), code: error?.code ?? 'UNKNOWN' })
        continue
      }

      entries.push({
        path: relative(root, fullPath),
        type: metadata.isSymbolicLink() ? 'link' : metadata.isDirectory() ? 'directory' : 'file',
        ...(metadata.isFile() ? { bytes: metadata.size } : {}),
      })

      if (metadata.isDirectory() && !metadata.isSymbolicLink()) visit(fullPath)
    }
  }

  if (existsSync(root)) visit(root)
  return { entries, errors, truncated }
}


export const config = {
  runner: 'local',
  specs: ['./tests/e2e/**/*.e2e.mjs'],
  maxInstances: 1,
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: appBinary,
    },
  }],
  services: [[
    'tauri',
    {
      appBinaryPath: appBinary,
      driverProvider: 'embedded',
      embeddedPort,
      captureBackendLogs: true,
      captureFrontendLogs: true,
      startTimeout: 90_000,
      statusPollTimeout: 10_000,
    },
  ]],
  framework: 'mocha',
  reporters: [
    'spec',
    ['junit', { outputDir: join(resultsRoot, 'junit'), outputFileFormat: () => `${phase}.junit.xml` }],
  ],
  outputDir: join(resultsRoot, 'logs', phase),
  logLevel: 'info',
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
  },
  onPrepare() {
    writeFileSync(join(resultsRoot, `run-manifest-${phase}.json`), JSON.stringify({
      schemaVersion: 1,
      platform: process.platform,
      architecture: process.arch,
      appBinary: relative(process.cwd(), appBinary),
      phase,
      driverProvider: 'embedded',
    }, null, 2))
  },
  async afterTest(test, _context, result) {
    if (result.passed) return

    const artifactDirectory = join(artifactsRoot, safeArtifactName(test.title))
    mkdirSync(artifactDirectory, { recursive: true })
    await browser.saveScreenshot(join(artifactDirectory, 'window.png')).catch(() => undefined)
    writeFileSync(join(artifactDirectory, 'vault-tree.json'), JSON.stringify(inventoryTree(vaultParent), null, 2))
    writeFileSync(join(artifactDirectory, 'failure.txt'), String(result.error?.stack ?? result.error ?? 'Unknown E2E failure'))
  },
  onComplete() {
    if (process.env.MIRRORMIND_E2E_ORCHESTRATED === 'true') return
    if (existsSync(runRoot)) removeOwnedRunRoot(resultsRoot, runRoot, ownerToken)
  },
}
