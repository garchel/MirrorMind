import { $, browser, expect } from '@wdio/globals'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createVault, typeIntoEditor, waitForEditorText, waitForFile, waitForTauriPlugin } from './helpers.mjs'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'safe-failure-state.json')
const supportedPhases = ['safe-failure', 'verify-safe-failure']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected safe-failure E2E phase: ${phase}`)

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
    await $('[aria-label="Título da nova nota"]').setValue('Bloqueada')
    await expect($('[aria-label^="Editor Markdown"]')).toBeDisplayed()
    const editorMode = await $('[aria-label="Modo de visualização da nota"]')
    const editButton = editorMode.$('.//button[normalize-space()="Edição"]')
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
