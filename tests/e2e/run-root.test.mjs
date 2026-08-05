import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createOwnedRunRoot, removeOwnedRunRoot, validateOwnedRunRoot } from './run-root.mjs'

describe('E2E run root ownership', () => {
  it('removes only the directory carrying the matching ownership token', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'mirrormind-e2e-owner-'))
    const resultsRoot = join(sandbox, 'results')
    const { runRoot, ownerToken } = createOwnedRunRoot(resultsRoot)

    try {
      expect(validateOwnedRunRoot(resultsRoot, runRoot, ownerToken)).toBe(runRoot)
      expect(() => removeOwnedRunRoot(resultsRoot, runRoot, 'wrong-token')).toThrow(/ownership/)
      expect(existsSync(runRoot)).toBe(true)

      removeOwnedRunRoot(resultsRoot, runRoot, ownerToken)
      expect(existsSync(runRoot)).toBe(false)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  it('refuses a preexisting run-prefixed directory without an ownership marker', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'mirrormind-e2e-preexisting-'))
    const resultsRoot = join(sandbox, 'results')
    const preexisting = join(resultsRoot, 'run-user-data')
    mkdirSync(preexisting, { recursive: true })

    try {
      expect(() => validateOwnedRunRoot(resultsRoot, preexisting, 'any-token')).toThrow()
      expect(() => removeOwnedRunRoot(resultsRoot, preexisting, 'any-token')).toThrow()
      expect(existsSync(preexisting)).toBe(true)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})
