import { $, browser, expect } from '@wdio/globals'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'journey-state.json')

if (!['create-and-save', 'reopen'].includes(phase)) throw new Error(`Unexpected E2E phase: ${phase}`)

if (phase === 'create-and-save') describe('Criar e salvar', () => {
  it('persiste uma nota no NTFS antes de encerrar o app', async () => {
    const vaultName = 'Vault E2E'
    const noteTitle = 'Primeira nota'
    const noteSlug = 'primeira-nota'
    const initialContent = 'Jornada E2E salva pelo aplicativo.'
    const appendedContent = ' Alteracao persistida pelo autosave.'
    const finalContent = `${initialContent}${appendedContent}`
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const notePath = join(vaultPath, `${noteSlug}.md`)

    await browser.waitUntil(
      async () => browser.execute(() => 'wdioTauri' in window),
      { timeout: 15_000, timeoutMsg: 'O plugin WebdriverIO nao foi inicializado no frontend.' },
    )

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
      async () => (await $('.workspace-status').getText()).includes('Vault carregado'),
      { timeout: 20_000, timeoutMsg: 'O scan inicial do Vault nao foi concluido.' },
    )

    await $('[aria-label="Configuracoes"]').click()
    const autoSaveToggle = await $('.settings-toggle*=Auto Save').$('input[type="checkbox"]')
    await expect(autoSaveToggle).toBeDisplayed()
    if (!(await autoSaveToggle.isSelected())) {
      await autoSaveToggle.click()
    }
    await expect(autoSaveToggle).toBeSelected()
    await $('[aria-label="Voltar para notas"]').click()

    await $('[aria-label="Nova nota"]').click()

    const titleInput = await $('[aria-label="Titulo da nova nota"]')
    await expect(titleInput).toBeDisplayed()
    await titleInput.setValue(noteTitle)

    await $('.markdown-mixed article').click()
    const draftEditor = await $('[aria-label^="Editor Markdown"]')
    await expect(draftEditor).toBeDisplayed()
    await draftEditor.setValue(initialContent)
    await browser.waitUntil(
      async () => (await $('[aria-label^="Editor Markdown"]').getText()) === initialContent,
      { timeoutMsg: 'O editor nao refletiu o conteudo inicial digitado.' },
    )
    await titleInput.click()
    await browser.keys('Enter')

    await browser.waitUntil(
      () => {
        try {
          return readFileSync(notePath, 'utf8') === initialContent
        } catch {
          return false
        }
      },
      { timeout: 20_000, timeoutMsg: 'A criacao da nota nao chegou ao arquivo Markdown.' },
    )

    await $('.markdown-mixed article').click()
    const savedEditor = await $('[aria-label^="Editor Markdown"]')
    await savedEditor.setValue(finalContent)
    await expect(savedEditor).toHaveText(finalContent)
    await expect($('.autosave-indicator')).toHaveText('Salvo', { wait: 20_000 })
    await browser.waitUntil(
      () => readFileSync(notePath, 'utf8') === finalContent,
      { timeout: 20_000, timeoutMsg: 'O autosave nao persistiu os bytes esperados.' },
    )

    writeFileSync(journeyStatePath, JSON.stringify({
      finalContent,
      noteSlug,
      vaultName,
    }))
  })
})

if (phase === 'reopen') describe('Reabrir em novo processo', () => {
  it('confirma o Vault recente e reabre os bytes persistidos', async () => {
    const { finalContent, noteSlug, vaultName } = JSON.parse(readFileSync(journeyStatePath, 'utf8'))
    const notePath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName, `${noteSlug}.md`)

    await browser.waitUntil(
      async () => browser.execute(() => 'wdioTauri' in window),
      { timeout: 15_000, timeoutMsg: 'O plugin WebdriverIO nao foi inicializado no novo processo.' },
    )

    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(vaultName))
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-shell')).toBeDisplayed()
    await expect($('.workspace-title')).toHaveText(vaultName)

    const reopenedNote = await $(`[aria-label="Abrir nota ${noteSlug}"]`)
    await expect(reopenedNote).toBeDisplayed()
    await reopenedNote.click()
    await $('.markdown-mixed article').click()

    const reopenedEditor = await $('[aria-label^="Editor Markdown"]')
    await expect(reopenedEditor).toBeDisplayed()
    await browser.waitUntil(
      async () => (await reopenedEditor.getText()) === finalContent,
      { timeout: 15_000, timeoutMsg: 'O conteudo reaberto na interface difere do arquivo.' },
    )
    expect(readFileSync(notePath, 'utf8')).toBe(finalContent)
  })
})
