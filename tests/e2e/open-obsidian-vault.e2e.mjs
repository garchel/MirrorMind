import { $, browser, expect } from '@wdio/globals'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'obsidian-vault-state.json')
const supportedPhases = ['open-obsidian-vault', 'verify-open-obsidian-vault']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected obsidian-vault E2E phase: ${phase}`)

const VAULT_NAME = 'Vault Obsidian E2E'
const NOTE_RELATIVE_PATH = 'Notas/estudo.md'
const EDITED_CONTENT = '# Estudo\n\nConteudo original do vault Obsidian.\n\nEditado pelo MirrorMind na jornada E2E.'

// Arquivos do Obsidian e arquivos desconhecidos que o app NAO pode alterar.
const PROTECTED_FILES = [
  '.obsidian/app.json',
  '.obsidian/appearance.json',
  '.obsidian/community-plugins.json',
  '.obsidian/workspace.json',
  'Anexos/plano.pdf',
  'diversos/nota-bruta.txt',
  '.DS_Store',
  'arquivo-sem-extensao',
]

async function waitForTauriPlugin() {
  await browser.waitUntil(
    async () => browser.execute(() => 'wdioTauri' in window),
    { timeout: 15_000, timeoutMsg: 'O plugin WebdriverIO nao foi inicializado.' },
  )
}

async function waitForEditorText(expectedText) {
  const expected = expectedText.replace(/\r\n/g, '\n').trimEnd()
  await browser.waitUntil(
    async () => {
      const editor = await $('[aria-label^="Editor Markdown"]')
      return (await editor.isExisting())
        && await browser.execute((target) => (
          Array.from(target.querySelectorAll('.cm-line'))
            .map((line) => line.textContent ?? '')
            .join('\n')
        ), editor).then((text) => text.replace(/\r\n/g, '\n').trimEnd()) === expected
    },
    { timeout: 10_000, timeoutMsg: `O editor nao exibiu o conteudo esperado: ${expectedText}` },
  )
}

async function waitForFile(path, predicate, timeoutMsg) {
  await browser.waitUntil(
    () => {
      try {
        return predicate(readFileSync(path, 'utf8'))
      } catch {
        return false
      }
    },
    { timeout: 20_000, timeoutMsg },
  )
}

function snapshotFiles(vaultPath, relativePaths) {
  return relativePaths.map((relativePath) => {
    const fullPath = join(vaultPath, relativePath)
    if (!existsSync(fullPath)) return { relativePath, exists: false }
    return {
      relativePath,
      exists: true,
      bytes: readFileSync(fullPath).toString('base64'),
      modifiedMs: statSync(fullPath).mtimeMs,
    }
  })
}

function assertSnapshotUnchanged(vaultPath, snapshot, label) {
  for (const entry of snapshot) {
    const fullPath = join(vaultPath, entry.relativePath)
    if (!entry.exists) {
      if (existsSync(fullPath)) throw new Error(`${label}: '${entry.relativePath}' foi criado inesperadamente.`)
      continue
    }
    if (!existsSync(fullPath)) throw new Error(`${label}: '${entry.relativePath}' foi removido.`)
    const current = readFileSync(fullPath).toString('base64')
    if (current !== entry.bytes) throw new Error(`${label}: '${entry.relativePath}' teve o conteudo alterado.`)
    if (statSync(fullPath).mtimeMs !== entry.modifiedMs) {
      throw new Error(`${label}: '${entry.relativePath}' teve a data de modificacao alterada.`)
    }
  }
}

function listTree(root) {
  const names = []
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const fullPath = join(directory, name)
      names.push(fullPath)
      if (statSync(fullPath).isDirectory() && name !== '.mirmind') visit(fullPath)
    }
  }
  visit(root)
  return names
}

async function createObsidianFixture() {
  const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, VAULT_NAME)
  mkdirSync(join(vaultPath, '.obsidian'), { recursive: true })
  mkdirSync(join(vaultPath, 'Notas'), { recursive: true })
  mkdirSync(join(vaultPath, 'Diario'), { recursive: true })
  mkdirSync(join(vaultPath, 'Anexos'), { recursive: true })
  mkdirSync(join(vaultPath, 'diversos'), { recursive: true })

  writeFileSync(join(vaultPath, '.obsidian', 'app.json'), JSON.stringify({
    showLineNumber: true,
    readableLineLength: true,
    attachmentFolderPath: './media',
  }, null, 2))
  writeFileSync(join(vaultPath, '.obsidian', 'appearance.json'), JSON.stringify({
    theme: 'obsidian',
    accentColor: '#c46a2b',
    baseFontSize: 18,
    cssTheme: 'Minimal',
  }, null, 2))
  writeFileSync(join(vaultPath, '.obsidian', 'community-plugins.json'), '["dataview","tasks"]')
  writeFileSync(join(vaultPath, '.obsidian', 'workspace.json'), JSON.stringify({ left: { collapsed: false } }))
  writeFileSync(join(vaultPath, 'Notas', 'estudo.md'), '# Estudo\n\nConteudo original do vault Obsidian.')
  writeFileSync(join(vaultPath, 'Diario', '2026-08-14.md'), '# Diario\n\nEntrada diaria do vault.')
  writeFileSync(join(vaultPath, 'Anexos', 'plano.pdf'), 'PDF ficticio do vault Obsidian (bytes nao suportados).')
  writeFileSync(join(vaultPath, 'diversos', 'nota-bruta.txt'), 'Arquivo de texto desconhecido.')
  writeFileSync(join(vaultPath, '.DS_Store'), Buffer.from([0, 1, 2, 3, 0xff, 0xfe, 0xfd]))
  writeFileSync(join(vaultPath, 'arquivo-sem-extensao'), 'Arquivo sem extensao que o app deve preservar.')
  return vaultPath
}

if (phase === 'open-obsidian-vault') describe('Abrir Vault Obsidian', () => {
  it('abre fixture real, navega, edita e nao altera .obsidian nem arquivos desconhecidos', async () => {
    await waitForTauriPlugin()
    const vaultPath = await createObsidianFixture()
    const protectedSnapshot = snapshotFiles(vaultPath, PROTECTED_FILES)

    // Abre o vault existente via E2E: o backend seleciona o fixture isolado
    // em vez de abrir o dialogo nativo de pasta (marcador lido pelo build e2e).
    const markerPath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'e2e-existing-vault.json')
    writeFileSync(markerPath, JSON.stringify(vaultPath))
    const openCard = await $('article.action-card')
    await expect(openCard).toBeDisplayed()
    await openCard.$('.//button[normalize-space()="Escolher pasta"]').click()
    await expect($('.workspace-shell')).toBeDisplayed()
    await browser.waitUntil(
      async () => (await $('.workspace-title').getText()).includes(VAULT_NAME),
      { timeout: 20_000, timeoutMsg: 'O scan inicial do vault Obsidian nao foi concluido.' },
    )

    // Nenhum arquivo do Obsidian nem desconhecido foi tocado so pela abertura.
    assertSnapshotUnchanged(vaultPath, protectedSnapshot, 'Abertura')

    // Navega pelas pastas e abre a nota suportada.
    await $('[aria-label="Pasta Notas"]').click()
    await $('[aria-label="Abrir nota estudo"]').click()
    await waitForEditorText('# Estudo\n\nConteudo original do vault Obsidian.')

    // Edita a nota e salva pelos bytes do arquivo. O modo Edicao propaga a
    // digitacao programatica como sujeira (o Misto nao) e o Ctrl+S grava.
    const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
    const editButton = editorMode.$('.//button[normalize-space()="Edicao"]')
    await expect(editButton).toBeDisplayed()
    await editButton.click()
    await expect(editButton).toHaveAttribute('aria-checked', 'true')
    const editor = await $('[aria-label^="Editor Markdown"]')
    await editor.click()
    await browser.keys(['Control', 'a'])
    await browser.keys('Delete')
    await editor.addValue(EDITED_CONTENT)
    await waitForEditorText(EDITED_CONTENT)
    await browser.keys(['Control', 's'])
    await waitForFile(
      join(vaultPath, NOTE_RELATIVE_PATH),
      (content) => content === EDITED_CONTENT,
      'A edicao da nota suportada nao chegou ao arquivo Markdown.',
    )

    // A segunda nota continua listada e abre sem problemas.
    await $('[aria-label="Pasta Diario"]').click()
    await $('[aria-label="Abrir nota 2026-08-14"]').click()
    await waitForEditorText('# Diario\n\nEntrada diaria do vault.')

    // O .obsidian e os arquivos desconhecidos continuam intactos apos editar.
    assertSnapshotUnchanged(vaultPath, protectedSnapshot, 'Apos editar')

    writeFileSync(journeyStatePath, JSON.stringify({
      editedContent: EDITED_CONTENT,
      noteRelativePath: NOTE_RELATIVE_PATH,
      protectedSnapshot,
      vaultName: VAULT_NAME,
    }))
  })
})

if (phase === 'verify-open-obsidian-vault') describe('Reabrir vault Obsidian', () => {
  it('reabre em novo processo com o .obsidian e os arquivos desconhecidos intactos', async () => {
    const { editedContent, noteRelativePath, protectedSnapshot, vaultName } = JSON.parse(
      readFileSync(journeyStatePath, 'utf8'),
    )
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)

    await waitForTauriPlugin()
    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(vaultName))
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-title')).toHaveText(vaultName)
    assertSnapshotUnchanged(vaultPath, protectedSnapshot, 'Reabertura')

    await $('[aria-label="Pasta Notas"]').click()
    await $('[aria-label="Abrir nota estudo"]').click()
    await waitForEditorText(editedContent)

    // O inventario continua listando os arquivos desconhecidos e o .obsidian
    // nao recebeu nenhum arquivo novo alem do que ja existia.
    const vaultTree = listTree(vaultPath).map((path) => path.replaceAll('\\', '/').slice(vaultPath.length + 1))
    const protectedRelatives = protectedSnapshot.map((entry) => entry.relativePath)
    for (const relative of protectedRelatives) {
      expect(vaultTree).toContain(relative)
    }
    const obsidianEntries = vaultTree.filter((path) => path.startsWith('.obsidian/'))
    expect(obsidianEntries.sort()).toEqual(protectedRelatives.filter((path) => path.startsWith('.obsidian/')).sort())
  })
})
