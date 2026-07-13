export type WorkspaceShortcuts = {
  createNote: string
  openNote: string
  openTagFilter: string
  openCommandPalette: string
}

export const DEFAULT_WORKSPACE_SHORTCUTS: WorkspaceShortcuts = {
  createNote: 'Ctrl+N',
  openNote: 'Ctrl+O',
  openTagFilter: 'Ctrl+Shift+F',
  openCommandPalette: 'Ctrl+K',
}

export function formatShortcut(event: KeyboardEvent) {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  const modifiers = [event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean)
  return [...modifiers, key].join('+')
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  return formatShortcut(event).toLowerCase() === shortcut.toLowerCase()
}
