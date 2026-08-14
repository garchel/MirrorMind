import { $, browser, expect } from '@wdio/globals'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'safe-failure-state.json')
const supportedPhases = ['safe-failure', 'verify-safe-failure']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected safe-failure E2E phase: ${phase}`)

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

async function typeIntoEditor(content) {
  const editor = await $('[aria-label^="Editor Markdown"]')
  await editor.click()
  await browser.keys(['Control', 'a'])
  await browser.keys('Delete')
  await editor.addValue(content)
  await waitForEditorText(content)
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

if (phase === 'safe-failure') describe('Falha segura', () => {
  it('arquivo bloqueado: mensagem clara, rascunho preservado, sem escrita parcial e rollback apos desbloquear', async () => {
    const vaultName = 'Vault Falha Segura E2E'
    const noteSlug = 'bloqueada'
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const notePath = join(vaultPath, `${noteSlug}.md`)
    const savedContent = 'Conteudo salvo antes do bloqueio.'
    const draftContent = `${savedContent}\n\nRascunho protegido pelo editor.`

    await waitForTauriPlugin()
    await createVault(vaultName)

    // Cria a nota pela interface e confirma os bytes no disco (autosave
    // desligado por padrao: o salvamento acontece so pelo Ctrl+S). O modo
    // Edicao propaga a digitacao programatica como sujeira (o Misto nao).
    await $('[aria-label="Nova nota"]').click()
    await $('[aria-label="Titulo da nova nota"]').setValue('Bloqueada')
    await expect($('[aria-label^="Editor Markdown"]')).toBeDisplayed()
    const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
    const editButton = editorMode.$('.//button[normalize-space()="Edicao"]')
    await expect(editButton).toBeDisplayed()
    await editButton.click()
    await expect(editButton).toHaveAttribute('aria-checked', 'true')
    await typeIntoEditor(savedContent)
    await browser.keys(['Control', 's'])
    await waitForFile(notePath, (content) => content === savedContent, 'A nota nao chegou ao disco antes do bloqueio.')

    // Simula arquivo bloqueado: somente leitura no Windows (abertura para
    // escrita falha com acesso negado), como um processo concorrente faria.
    chmodSync(notePath, 0o444)

    // Rascunho digitado e salvamento: a falha deve ser clara, sem perder bytes.
    await typeIntoEditor(draftContent)
    await browser.keys(['Control', 's'])

    const errorBanner = await $('.error-banner')
    await expect(errorBanner).toBeDisplayed({ wait: 10_000 })
    const bannerDom = await browser.execute((target) => ({
      outerHTML: target?.outerHTML ?? null,
      textContent: target?.textContent ?? null,
      className: target?.className ?? null,
      connected: target?.isConnected ?? null,
    }), errorBanner)
    console.log('BANNER_DOM', JSON.stringify(bannerDom))
    const editorDom = await browser.execute((target) => {
      const lines = Array.from(target.querySelectorAll('.cm-line')).map((line) => line.textContent ?? '')
      return { lines }
    }, await $('[aria-label^="Editor Markdown"]'))
    console.log('EDITOR_LINES', JSON.stringify(editorDom.lines))
    await expect(errorBanner).toHaveText(expect.stringContaining(noteSlug))

    // Nenhuma perda: o rascunho continua no editor e o disco preserva os
    // bytes antigos (sem escrita parcial, sem truncamento).
    await waitForEditorText(draftContent)
    expect(readFileSync(notePath, 'utf8')).toBe(savedContent)

    // Desbloqueia (o processo concorrente liberou o arquivo) e o mesmo
    // rascunho salva por completo: recuperacao sem reconstrucao manual.
    chmodSync(notePath, 0o644)
    await browser.keys(['Control', 's'])
    await waitForFile(notePath, (content) => content === draftContent, 'O salvamento apos desbloquear nao gravou o rascunho.')
    await expect($('.error-banner')).not.toBeDisplayed()

    writeFileSync(journeyStatePath, JSON.stringify({
      draftContent,
      noteSlug,
      savedContent,
      vaultName,
    }))
  })
})

if (phase === 'verify-safe-failure') describe('Reabrir apos falha segura', () => {
  it('reabre com o rascunho recuperado e sem banners de erro', async () => {
    const { draftContent, noteSlug, vaultName } = JSON.parse(readFileSync(journeyStatePath, 'utf8'))
    const notePath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName, `${noteSlug}.md`)

    await waitForTauriPlugin()
    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(vaultName))
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-title')).toHaveText(vaultName)
    expect(readFileSync(notePath, 'utf8')).toBe(draftContent)
    await expect($('.error-banner')).not.toBeDisplayed()

    await $('[aria-label="Abrir nota bloqueada"]').click()
    await waitForEditorText(draftContent)
    expect(readFileSync(notePath, 'utf8')).toBe(draftContent)
  })
})
