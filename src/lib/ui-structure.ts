export const UI_STRUCTURE = {
  vaultSelection: {
    shell: 'vault-selection-shell',
    navigationRail: 'vault-selection-rail',
    mainPanel: 'vault-selection-main',
    actionGrid: 'vault-selection-actions',
    recentVaultModal: 'recent-vault-modal',
  },
  workspace: {
    shell: 'workspace-shell',
    navigationRail: 'workspace-rail',
    fileExplorer: 'notes-sidebar',
    tabBar: 'tab-strip',
    editor: 'editor-surface',
    statusNotice: 'workspace-status',
  },
} as const

export const BUILDER_FRIENDLY_NAMES: Record<string, string> = {
  'vault-selection-shell': 'Tela de selecao de vault',
  'vault-selection-rail': 'Barra lateral da selecao',
  'vault-selection-actions': 'Acoes de vault',
  'recent-vault-modal': 'Confirmacao do ultimo vault',
  'workspace-shell': 'Workspace de notas',
  'workspace-rail': 'Barra de ferramentas',
  'notes-sidebar': 'Explorador de arquivos',
  'tab-strip': 'Barra de abas',
  'editor-surface': 'Editor de notas',
  'workspace-status': 'Aviso de status',
}
