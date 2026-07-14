import { z } from 'zod'

export type NotePreview = {
  name: string
  relativePath: string
}

export type NoteDocument = {
  name: string
  relativePath: string
  content: string
}

export type VaultMetadata = {
  isInitialized: boolean
  rootPath: string
  missing: string[]
}

export type VaultSummary = {
  name: string
  path: string
  noteCount: number
  notePreviews: NotePreview[]
  isObsidianVault: boolean
  metadata: VaultMetadata
}

export type CreateVaultForm = {
  parentPath: string
  name: string
}

export type CreateNoteForm = {
  title: string
}

export type RecentVaultPreference = {
  lastVaultPath: string | null
  askBeforeReopen: boolean
}

export type HistoryStatus = { canUndo: boolean; canRedo: boolean }

export type NoteTreeNode = {
  id: string
  name: string
  path: string
  type: 'folder' | 'note'
  children?: NoteTreeNode[]
}

const vaultSummarySchema = z.object({
  name: z.string(),
  path: z.string(),
  noteCount: z.number(),
  notePreviews: z.array(
    z.object({
      name: z.string(),
      relativePath: z.string(),
    }),
  ),
  isObsidianVault: z.boolean(),
  metadata: z.object({
    isInitialized: z.boolean(),
    rootPath: z.string(),
    missing: z.array(z.string()),
  }),
})

const noteDocumentSchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  content: z.string(),
})

const notePreviewSchema = z.object({
  name: z.string(),
  relativePath: z.string(),
})

const recentVaultPreferenceSchema = z.object({
  lastVaultPath: z.string().nullable(),
  askBeforeReopen: z.boolean(),
})

const historyStatusSchema = z.object({ canUndo: z.boolean(), canRedo: z.boolean() })

const INVALID_VAULT_CHARACTERS = /[<>:"/\\|?*]/
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

export function suggestVaultName() {
  return 'MirrorMind Vault'
}

export function formatDailyNotePath(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `Diarias/${year}-${month}-${day}.md`
}

export function formatVaultNameError(name: string) {
  const trimmed = name.trim()

  if (!trimmed) {
    return 'Defina um nome para o novo vault.'
  }

  if (INVALID_VAULT_CHARACTERS.test(trimmed)) {
    return 'O nome do vault nao pode usar os caracteres < > : " / \\ | ? *.'
  }

  if (/[. ]$/.test(trimmed)) {
    return 'O nome do vault nao pode terminar com ponto ou espaco.'
  }

  if (WINDOWS_RESERVED_NAMES.has(trimmed.toUpperCase())) {
    return 'Esse nome e reservado pelo Windows e nao pode ser usado.'
  }

  return null
}

export function buildVaultPathPreview(parentPath: string, name: string) {
  if (!parentPath) {
    return 'Nenhuma pasta pai escolhida ainda.'
  }

  const trimmedName = name.trim() || 'novo-vault'
  const separator = parentPath.includes('\\') ? '\\' : '/'
  const suffix = parentPath.endsWith(separator) ? '' : separator
  return `${parentPath}${suffix}${trimmedName}`
}

export function getVaultModeLabel(vault: VaultSummary) {
  if (vault.isObsidianVault) {
    return 'Vault Obsidian suportado'
  }

  return 'Vault Markdown local'
}

export function parseVaultSummary(payload: unknown) {
  return vaultSummarySchema.parse(payload)
}

export function parseNoteDocument(payload: unknown) {
  return noteDocumentSchema.parse(payload)
}

export function parseNoteList(payload: unknown) {
  return z.array(notePreviewSchema).parse(payload)
}

export function parseRecentVaultPreference(payload: unknown) {
  return recentVaultPreferenceSchema.parse(payload)
}

export function parseHistoryStatus(payload: unknown) {
  return historyStatusSchema.parse(payload)
}

export function formatNoteTitleAsPath(title: string) {
  const trimmed = title.trim()
  if (!trimmed) {
    return null
  }

  const sanitized = trimmed
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()

  if (!sanitized) {
    return null
  }

  return `${sanitized}.md`
}

export function buildNoteTree(notes: NotePreview[], folders: string[] = []) {
  type MutableNode = NoteTreeNode & { children?: MutableNode[] }
  const root: MutableNode[] = []

  function ensureFolder(segments: string[]) {
    let currentLevel = root
    segments.forEach((segment, index) => {
      const accumulatedPath = segments.slice(0, index + 1).join('/')
      let existing = currentLevel.find((node) => node.name === segment && node.type === 'folder')
      if (!existing) {
        existing = {
          id: accumulatedPath,
          name: segment,
          path: accumulatedPath,
          type: 'folder',
          children: [],
        }
        currentLevel.push(existing)
      }
      existing.children ??= []
      currentLevel = existing.children
    })
  }

  folders.forEach((folder) => ensureFolder(folder.split('/').filter(Boolean)))

  for (const note of notes) {
    const segments = note.relativePath.split('/').filter(Boolean)
    let currentLevel = root

    segments.forEach((segment, index) => {
      const accumulatedPath = segments.slice(0, index + 1).join('/')
      const isLeaf = index === segments.length - 1
      const existing = currentLevel.find((node) => node.name === segment)

      if (existing) {
        if (!isLeaf) {
          existing.children ??= []
          currentLevel = existing.children
        }
        return
      }

      if (isLeaf) {
        currentLevel.push({
          id: accumulatedPath,
          name: note.name,
          path: note.relativePath,
          type: 'note',
        })
        return
      }

      const folderNode: MutableNode = {
        id: accumulatedPath,
        name: segment,
        path: accumulatedPath,
        type: 'folder',
        children: [],
      }

      currentLevel.push(folderNode)
      currentLevel = folderNode.children ?? []
    })
  }

  function sortNodes(nodes: MutableNode[]): NoteTreeNode[] {
    return nodes
      .map((node) =>
        node.type === 'folder' && node.children
          ? { ...node, children: sortNodes(node.children) }
          : node,
      )
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'folder' ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      })
  }

  return sortNodes(root)
}
