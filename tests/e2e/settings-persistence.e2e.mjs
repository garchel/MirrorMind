import { $, browser, expect } from '@wdio/globals'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'settings-state.json')
const supportedPhases = ['configure-settings', 'verify-settings-reopen', 'verify-settings-autoload']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected settings E2E phase: ${phase}`)

const VAULT_NAME = 'Vault Config E2E'
const SHORTCUT = 'Ctrl+Shift+N'

async function waitForTauriPlugin() {
  await browser.waitUntil(
    async () => browser.execute(() => 'wdioTauri' in window),
    { timeout: 15_000, timeoutMsg: 'O plugin WebdriverIO nao foi inicializado.' },
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

async function createVault(vaultName) {
  const createCard = await $('article.action-card--accent')
  await expect(createCard).toBeDisplayed()
  await createCard.$('input').setValue(vaultName)
  await createCard.$('.//button[normalize-space()="Escolher pasta pai"]').click()
  await browser.waitUntil(
    async () => (await createCard.$('small').getText()).includes(vaultName),
    { timeoutMsg: 'A pasta pai isolada nao foi selecionada.' },
  )
  await createCard.$('.//button[normalize-space()="Criar vault"]').click()
  await expect($('.workspace-shell')).toBeDisplayed()
  await browser.waitUntil(
    async () => (await $('.workspace-title').getText()).includes(vaultName),
    { timeout: 20_000, timeoutMsg: 'O scan inicial do Vault nao foi concluido.' },
  )
}

async function assertConfiguredSettings() {
  // Autosave permanece ligado apos o reinicio.
  await $('[aria-label="Configuracoes"]').click()
  const autoSaveToggle = await $('.settings-toggle*=Auto Save').$('input[type="checkbox"]')
  await expect(autoSaveToggle).toBeSelected()

  // O atalho personalizado permanece configurado (Configurações > Atalhos).
  await $('nav.settings-nav').$('.//button[normalize-space()="Atalhos"]').click()
  const shortcutInput = await $('[aria-label="Atalho para criar nova nota"]')
  await expect(shortcutInput).toHaveValue(SHORTCUT)
  await $('[aria-label="Voltar para notas"]').click()
}

async function selectEditMode() {
  const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
  const editButton = editorMode.$('.//button[normalize-space()="Edicao"]')
  await expect(editButton).toBeDisplayed()
  await editButton.click()
  await expect(editButton).toHaveAttribute('aria-checked', 'true')
}

if (phase === 'configure-settings') describe('Configurar preferencias', () => {
  it('ativa autosave, personaliza um atalho e persiste as preferencias', async () => {
    await waitForTauriPlugin()
    await createVault(VAULT_NAME)

    // Autosave ligado nas configuracoes do vault.
    await $('[aria-label="Configuracoes"]').click()
    const autoSaveToggle = await $('.settings-toggle*=Auto Save').$('input[type="checkbox"]')
    await expect(autoSaveToggle).toBeDisplayed()
    if (!(await autoSaveToggle.isSelected())) {
      await autoSaveToggle.click()
    }
    await expect(autoSaveToggle).toBeSelected()

    // Atalho personalizado (Configurações > Atalhos): foca o campo e pressiona a nova combinacao.
    await $('nav.settings-nav').$('.//button[normalize-space()="Atalhos"]').click()
    const shortcutInput = await $('[aria-label="Atalho para criar nova nota"]')
    await shortcutInput.click()
    await browser.keys(['Control', 'Shift', 'N'])
    await expect(shortcutInput).toHaveValue(SHORTCUT)

    await $('[aria-label="Voltar para notas"]').click()
    writeFileSync(journeyStatePath, JSON.stringify({ vaultName: VAULT_NAME }))
  })
})

if (phase === 'verify-settings-reopen') describe('Reiniciar e confirmar preferencias', () => {
  it('reabre com autosave e atalho persistentes, grava pelo autosave e desativa a pergunta de reabertura', async () => {
    const { vaultName } = JSON.parse(readFileSync(journeyStatePath, 'utf8'))
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const notePath = join(vaultPath, 'persistencia.md')
    const initialContent = 'Conteudo inicial persistente.'
    const autosavedContent = `${initialContent}\n\nSalvo automaticamente apos reiniciar.`

    await waitForTauriPlugin()

    // A reabertura ainda pergunta (preferencia padrao): desativa a partir do
    // proprio dialogo, como o usuario faria.
    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(vaultName))
    const skipPrompt = await $('.recent-vault-checkbox input[type="checkbox"]')
    await skipPrompt.click()
    await expect(skipPrompt).toBeSelected()
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-title')).toHaveText(vaultName)
    await assertConfiguredSettings()

    // O atalho personalizado abre a captura de nova nota.
    await browser.keys(['Control', 'Shift', 'N'])
    await expect($('[aria-label="Titulo da nova nota"]')).toBeDisplayed()

    // Autosave de verdade: edita uma nota existente e os bytes chegam ao disco
    // sem nenhum Ctrl+S (apenas o debounce de 650ms do autosave).
    writeFileSync(notePath, initialContent)
    await $('[aria-label="Atualizar explorador de arquivos"]').click()
    await $('[aria-label="Abrir nota persistencia"]').click()
    await expect($('[aria-label^="Editor Markdown"]')).toBeDisplayed()
    await selectEditMode()
    await waitForEditorText(initialContent)
    const editor = await $('[aria-label^="Editor Markdown"]')
    await editor.click()
    await browser.keys(['Control', 'a'])
    await browser.keys('Delete')
    await editor.addValue(autosavedContent)
    await expect($('.autosave-indicator')).toHaveText('Salvo', { wait: 20_000 })
    await waitForFile(notePath, (content) => content === autosavedContent, 'O autosave nao gravou a edicao apos reiniciar.')
  })
})

if (phase === 'verify-settings-autoload') describe('Reabertura automatica', () => {
  it('nao pergunta mais e abre o ultimo vault sozinho, com as preferencias persistentes', async () => {
    const { vaultName } = JSON.parse(readFileSync(journeyStatePath, 'utf8'))

    await waitForTauriPlugin()

    // Sem dialogo: a preferencia "nao perguntar novamente" persistiu.
    await expect($('.recent-vault-modal')).not.toBeDisplayed()
    await browser.waitUntil(
      async () => (await $('.workspace-title').getText()).includes(vaultName),
      { timeout: 20_000, timeoutMsg: 'O vault nao foi reaberto automaticamente.' },
    )
    await expect($('.workspace-title')).toHaveText(vaultName)
    await assertConfiguredSettings()
  })
})
