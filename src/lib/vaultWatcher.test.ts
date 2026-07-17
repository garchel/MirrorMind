import { describe, expect, it, vi } from 'vitest'
import type { VaultFileSystemChange } from './vault'
import {
  createVaultScanCoordinator,
  MAX_PENDING_VAULT_CHANGES,
  enqueueVaultFileSystemChange,
  isVaultWatcherEventForRequest,
} from './vaultWatcher'

const change = (index: number): VaultFileSystemChange => ({
  kind: 'modify',
  paths: [`note-${index}.md`],
})

describe('vault watcher queue', () => {
  it('preserves event order while the queue remains below its limit', () => {
    const queue: VaultFileSystemChange[] = []

    expect(enqueueVaultFileSystemChange(queue, change(1))).toBe('debounce')
    expect(enqueueVaultFileSystemChange(queue, change(2))).toBe('debounce')

    expect(queue).toEqual([change(1), change(2)])
  })

  it('collapses an event storm into one bounded immediate rescan request', () => {
    const queue: VaultFileSystemChange[] = []
    let rescanRequests = 0

    for (let index = 0; index < 10_000; index += 1) {
      if (enqueueVaultFileSystemChange(queue, change(index)) === 'rescan') {
        rescanRequests += 1
      }
    }

    expect(queue).toEqual([{ kind: 'rescan', paths: [] }])
    expect(queue.length).toBeLessThanOrEqual(MAX_PENDING_VAULT_CHANGES)
    expect(rescanRequests).toBe(1)
  })

  it('does not renew the debounce while a rescan is already queued', () => {
    const queue: VaultFileSystemChange[] = [{ kind: 'rescan', paths: [] }]

    expect(enqueueVaultFileSystemChange(queue, change(1))).toBe('unchanged')
    expect(enqueueVaultFileSystemChange(queue, { kind: 'remove', paths: ['note-2.md'] })).toBe('unchanged')

    expect(queue).toEqual([{ kind: 'rescan', paths: [] }])
  })

  it('rejects delayed events from a previous vault activation', () => {
    const event = { ...change(1), requestId: 41 }

    expect(isVaultWatcherEventForRequest(event, 42)).toBe(false)
    expect(isVaultWatcherEventForRequest({ ...event, requestId: 42 }, 42)).toBe(true)
  })

  it('coalesces concurrent scans into one trailing rescan', async () => {
    let releaseFirstScan: (() => void) | undefined
    let concurrentScans = 0
    let maximumConcurrency = 0
    const runScan = vi.fn(async (_change?: VaultFileSystemChange) => {
      concurrentScans += 1
      maximumConcurrency = Math.max(maximumConcurrency, concurrentScans)
      if (runScan.mock.calls.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstScan = resolve
        })
      }
      concurrentScans -= 1
    })
    const requestScan = createVaultScanCoordinator(runScan)

    const firstScan = requestScan(change(1))
    await Promise.resolve()
    await requestScan(change(2))
    await requestScan(change(3))
    releaseFirstScan?.()
    await firstScan

    expect(maximumConcurrency).toBe(1)
    expect(runScan).toHaveBeenCalledTimes(2)
    expect(runScan.mock.calls[1]?.[0]).toEqual({ kind: 'rescan', paths: [] })
  })
})