import { randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const ownerMarker = '.mirrormind-e2e-owner'

export function createOwnedRunRoot(resultsRoot) {
  const resolvedResultsRoot = resolve(resultsRoot)
  mkdirSync(resolvedResultsRoot, { recursive: true })
  const runRoot = mkdtempSync(join(resolvedResultsRoot, 'run-'))
  const ownerToken = randomUUID()
  writeFileSync(join(runRoot, ownerMarker), ownerToken, { encoding: 'utf8', flag: 'wx' })
  return { runRoot, ownerToken }
}

export function validateOwnedRunRoot(resultsRoot, runRoot, ownerToken) {
  if (!ownerToken) throw new Error('Missing E2E run ownership token.')

  const resolvedResultsRoot = resolve(resultsRoot)
  const resolvedRunRoot = resolve(runRoot)
  if (
    dirname(resolvedRunRoot) !== resolvedResultsRoot
    || !basename(resolvedRunRoot).startsWith('run-')
  ) {
    throw new Error(`Refusing unexpected E2E directory: ${resolvedRunRoot}`)
  }

  const metadata = lstatSync(resolvedRunRoot)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing E2E directory with unexpected file type: ${resolvedRunRoot}`)
  }

  const realResultsRoot = realpathSync(resolvedResultsRoot)
  const realRunRoot = realpathSync(resolvedRunRoot)
  if (dirname(realRunRoot) !== realResultsRoot) {
    throw new Error(`Refusing E2E directory outside the real results root: ${realRunRoot}`)
  }

  const recordedToken = readFileSync(join(realRunRoot, ownerMarker), 'utf8')
  if (recordedToken !== ownerToken) {
    throw new Error(`Refusing E2E directory without matching ownership: ${realRunRoot}`)
  }

  return realRunRoot
}

export function removeOwnedRunRoot(resultsRoot, runRoot, ownerToken) {
  const ownedRunRoot = validateOwnedRunRoot(resultsRoot, runRoot, ownerToken)
  rmSync(ownedRunRoot, { recursive: true, force: true })
}
