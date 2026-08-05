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
    fileExplorerHeader: 'vault-explorer-header',
    fileTree: 'vault-file-tree',
    contentPanel: 'workspace-content-panel',
    trashPage: 'trash-page',
    trashFiles: 'trash-files',
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
  'vault-explorer-header': 'Cabecalho do explorador do vault',
  'vault-file-tree': 'Arvore de arquivos do Vault',
  'trash-files': 'Arquivos da lixeira',
  'tab-strip': 'Barra de abas',
  'workspace-content-panel': 'Painel de conteudo do workspace',
  'trash-page': 'Pagina da lixeira',
  'workspace-status': 'Aviso de status',
}
