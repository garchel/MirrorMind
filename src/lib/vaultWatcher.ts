import { z } from 'zod'
import type { VaultFileSystemChange } from './vault'

export const MAX_PENDING_VAULT_CHANGES = 128
export const MAX_WATCHER_EVENT_PATHS = 256
export const MAX_WATCHER_PATH_LENGTH = 32_768
export type ScopedVaultFileSystemChange = VaultFileSystemChange & { requestId: number }

const requestIdSchema = z.number().int().safe().nonnegative()
const watcherPathSchema = z.string()
  .min(1)
  .max(MAX_WATCHER_PATH_LENGTH)
  .refine((path) => {
    if (path.includes('\0') || path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) {
      return false
    }
    return !path.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')
  }, 'Watcher paths must be confined relative paths')
const boundedWatcherPathsSchema = z.array(watcherPathSchema).min(1).max(MAX_WATCHER_EVENT_PATHS)
const scopedVaultFileSystemChangeSchema = z.discriminatedUnion('kind', [
  z.object({ requestId: requestIdSchema, kind: z.literal('create'), paths: boundedWatcherPathsSchema }),
  z.object({ requestId: requestIdSchema, kind: z.literal('modify'), paths: boundedWatcherPathsSchema }),
  z.object({ requestId: requestIdSchema, kind: z.literal('remove'), paths: boundedWatcherPathsSchema }),
  z.object({ requestId: requestIdSchema, kind: z.literal('rename'), paths: z.array(watcherPathSchema).length(2) }),
  z.object({ requestId: requestIdSchema, kind: z.literal('rescan'), paths: z.array(watcherPathSchema).length(0) }),
])

export function parseScopedVaultFileSystemChange(payload: unknown): ScopedVaultFileSystemChange {
  return scopedVaultFileSystemChangeSchema.parse(payload)
}

export function isVaultWatcherEventForRequest(
  change: unknown,
  requestId: number,
): change is ScopedVaultFileSystemChange {
  const parsed = scopedVaultFileSystemChangeSchema.safeParse(change)
  return parsed.success && parsed.data.requestId === requestId
}
export type VaultWatcherQueueAction = 'debounce' | 'rescan' | 'unchanged'

type VaultScan = (change?: VaultFileSystemChange) => Promise<void>

export function enqueueVaultFileSystemChange(
  queue: VaultFileSystemChange[],
  change: VaultFileSystemChange,
): VaultWatcherQueueAction {
  if (queue.some((pendingChange) => pendingChange.kind === 'rescan')) {
    return 'unchanged'
  }

  if (change.kind === 'rescan' || queue.length >= MAX_PENDING_VAULT_CHANGES) {
    queue.splice(0, queue.length, { kind: 'rescan', paths: [] })
    return 'rescan'
  }

  queue.push(change)
  return 'debounce'
}

export function createVaultScanCoordinator(runScan: VaultScan) {
  let inFlight = false
  let pendingRescan = false

  return async (change?: VaultFileSystemChange): Promise<void> => {
    if (inFlight) {
      pendingRescan = true
      return
    }

    inFlight = true
    let nextChange = change
    try {
      do {
        pendingRescan = false
        await runScan(nextChange)
        nextChange = { kind: 'rescan', paths: [] }
      } while (pendingRescan)
    } finally {
      inFlight = false
    }
  }
}