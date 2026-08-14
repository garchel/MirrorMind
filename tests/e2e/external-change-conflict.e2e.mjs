import { $, browser, expect } from '@wdio/globals'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'external-conflict-state.json')
const supportedPhases = ['external-change-conflict', 'verify-external-change', 'automatic-detect']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected external-change E2E phase: ${phase}`)

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

async function waitForMissing(path, timeoutMsg) {
  await browser.waitUntil(
    () => !existsSync(path),
    { timeout: 20_000, timeoutMsg },
  )
}

async function waitForEditorText(expectedText) {
  const expectedEditorText = expectedText.replace(/\r\n/g, '\n').trimEnd()
  await browser.waitUntil(
    async () => {
      const editor = await $('[aria-label^="Editor Markdown"]')
      return (await editor.isExisting())
        && await browser.execute((target) => (
          Array.from(target.querySelectorAll('.cm-line'))
            .map((line) => line.textContent ?? '')
            .join('\n')
        ), editor).then((text) => text.replace(/\r\n/g, '\n').trimEnd()) === expectedEditorText
    },
    {
      timeout: 10_000,
      timeoutMsg: `O editor nao exibiu o conteudo esperado: ${expectedText}`,
    },
  )
}

async function selectEditorMode(modeElement, mode) {
  const labels = { edit: 'Edicao', mixed: 'Misto', read: 'Leitura' }
  const radio = modeElement.$(`.//button[normalize-space()="${labels[mode]}"]`)
  await expect(radio).toBeDisplayed()
  await radio.click()
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

async function typeEditorText(content) {
  // Digitacao explicita no CodeMirror: foca, seleciona tudo, apaga e digita.
  // O `setValue` do WebdriverIO nao tipa de forma confiavel no contenteditable.
  const editor = await $('[aria-label^="Editor Markdown"]')
  await editor.click()
  await browser.keys(['Control', 'a'])
  await browser.keys('Delete')
  await editor.addValue(content)
  await waitForEditorText(content)
}

async function openNoteAndType(noteLabel, content) {
  await $('[aria-label="Abrir nota ' + noteLabel + '"]').click()
  const editor = await $('[aria-label^="Editor Markdown"]')
  await expect(editor).toBeDisplayed()
  const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
  await selectEditorMode(editorMode, 'edit')
  await typeEditorText(content)
}

/** Dispara o salvamento (Ctrl+S) e aguarda o dialogo de conflito aparecer. */
async function saveAndWaitForConflict() {
  await browser.keys(['Control', 's'])
  const dialog = await $('[aria-label="Alteracao externa detectada"]')
  await expect(dialog).toBeDisplayed({ wait: 15_000 })
  return dialog
}

if (phase === 'external-change-conflict') describe('Mudanca externa e conflito', () => {
  it('preserva o rascunho, reconcilia pela escolha do usuario e recupera nota removida', async () => {
    const vaultName = 'Vault Conflito E2E'
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const localNote = 'conflito'
    const removedNote = 'removida'
    const localNotePath = join(vaultPath, `${localNote}.md`)
    const removedNotePath = join(vaultPath, `${removedNote}.md`)
    const initialContent = 'Conteudo salvo inicial.'
    const firstDraft = `${initialContent}\n\nRascunho local nao salvo.`
    const firstExternal = 'Conteudo modificado por outro aplicativo.'
    const secondDraft = `${firstDraft}\n\nSegunda edicao local.`
    const secondExternal = 'Versao externa final.'
    const removedInitial = 'Conteudo da nota removida.'
    const removedDraft = `${removedInitial}\n\nRascunho da nota removida.`

    await waitForTauriPlugin()
    await createVault(vaultName)

    // Notas preparadas no vault real antes da interacao com a interface.
    writeFileSync(localNotePath, initialContent)
    writeFileSync(removedNotePath, removedInitial)
    await $('[aria-label="Atualizar explorador de arquivos"]').click()
    await expect($(`[aria-label="Abrir nota ${localNote}"]`)).toBeDisplayed()
    await expect($(`[aria-label="Abrir nota ${removedNote}"]`)).toBeDisplayed()

    // 1. Rascunho local nao salvo + modificacao externa: o Ctrl+S detecta a
    //    mudanca e abre o dialogo de conflito, preservando o rascunho.
    await openNoteAndType(localNote, firstDraft)
    writeFileSync(localNotePath, firstExternal)
    const conflictDialog = await saveAndWaitForConflict()
    await expect(conflictDialog).toHaveText(expect.stringContaining(localNote))

    // 2. Escolha do usuario: "Manter meu rascunho" mantem a versao local no
    //    editor e o Ctrl+S seguinte grava esses bytes no disco.
    await conflictDialog.$('.//button[normalize-space()="Manter meu rascunho"]').click()
    await waitForEditorText(firstDraft)
    await browser.keys(['Control', 's'])
    await waitForFile(
      localNotePath,
      (content) => content === firstDraft,
      'A escolha "manter rascunho" nao salvou a versao local.',
    )

    // 3. Segundo conflito: desta vez o usuario carrega a versao externa; o
    //    editor passa a refletir exatamente esses bytes e o disco concorda.
    await typeEditorText(secondDraft)
    writeFileSync(localNotePath, secondExternal)
    const secondConflict = await saveAndWaitForConflict()
    await secondConflict.$('.//button[normalize-space()="Carregar arquivo externo"]').click()
    await waitForEditorText(secondExternal)
    expect(readFileSync(localNotePath, 'utf8')).toBe(secondExternal)

    // 4. Remocao externa de uma nota aberta com rascunho: o dialogo aparece,
    //    preserva o rascunho e "Restaurar arquivo" devolve os bytes no caminho.
    await openNoteAndType(removedNote, removedDraft)
    rmSync(removedNotePath)
    await waitForMissing(removedNotePath, 'A remocao externa nao saiu do vault.')
    const removedDialog = await $('[aria-label="Nota removida fora do MirrorMind"]')
    await expect(removedDialog).toBeDisplayed({ wait: 15_000 })
    await expect(removedDialog).toHaveText(expect.stringContaining(removedNote))
    await removedDialog.$('.//button[normalize-space()="Restaurar arquivo"]').click()
    await waitForFile(
      removedNotePath,
      (content) => content === removedDraft,
      'A restauracao nao devolveu o rascunho preservado da nota removida.',
    )

    writeFileSync(journeyStatePath, JSON.stringify({
      firstDraft,
      localNote,
      removedDraft,
      removedNote,
      secondExternal,
      vaultName,
    }))
  })
})

if (phase === 'automatic-detect') describe('Deteccao automatica de mudanca externa (sem Ctrl+S)', () => {
  it('abre o dialogo de conflito com rascunho e recarrega silenciosamente sem rascunho', async () => {
    const vaultName = 'Vault Deteccao Automatica E2E'
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const notePath = join(vaultPath, 'auto.md')
    const initial = 'Conteudo inicial.'
    const draft = `${initial}\n\nRascunho local nao salvo.`
    const externalWithDraft = 'Versao externa com rascunho local.'
    const externalNoDraft = 'Versao externa sem rascunho local.'

    await waitForTauriPlugin()
    await createVault(vaultName)

    writeFileSync(notePath, initial)
    await $('[aria-label="Atualizar explorador de arquivos"]').click()
    await expect($('[aria-label="Abrir nota auto"]')).toBeDisplayed()
    await $('[aria-label="Abrir nota auto"]').click()
    await expect($('[aria-label^="Editor Markdown"]')).toBeDisplayed()
    const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
    await selectEditorMode(editorMode, 'edit')
    await waitForEditorText(initial)

    // 1. Com rascunho nao salvo: o dialogo de conflito aparece SOZINHO, sem
    //    nenhum Ctrl+S — via watcher (debounce 220ms) ou check periodico (2,5s).
    await typeEditorText(draft)
    await waitForEditorText(draft)
    writeFileSync(notePath, externalWithDraft)
    const dialog = await $('[aria-label="Alteracao externa detectada"]')
    await expect(dialog).toBeDisplayed({ wait: 12_000 })

    // 2. "Carregar arquivo externo" reconcilia o editor com os bytes externos.
    await dialog.$('.//button[normalize-space()="Carregar arquivo externo"]').click()
    await waitForEditorText(externalWithDraft)

    // 3. Sem rascunho: nova mudanca externa recarrega o editor silenciosamente.
    writeFileSync(notePath, externalNoDraft)
    await waitForEditorText(externalNoDraft)
    expect(readFileSync(notePath, 'utf8')).toBe(externalNoDraft)
  })
})

if (phase === 'verify-external-change') describe('Reabrir apos mudanca externa e conflito', () => {
  it('reabre com os bytes reconciliados e sem dialogo de conflito', async () => {
    const { firstDraft, localNote, removedDraft, removedNote, secondExternal, vaultName } = JSON.parse(
      readFileSync(journeyStatePath, 'utf8'),
    )
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const localNotePath = join(vaultPath, `${localNote}.md`)
    const removedNotePath = join(vaultPath, `${removedNote}.md`)

    await waitForTauriPlugin()
    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(vaultName))
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-title')).toHaveText(vaultName)
    // A reconciliacao e a restauracao persistiram entre processos.
    expect(readFileSync(localNotePath, 'utf8')).toBe(secondExternal)
    expect(readFileSync(removedNotePath, 'utf8')).toBe(removedDraft)
    await expect($('[aria-label="Alteracao externa detectada"]')).not.toBeDisplayed()
    await expect($('[aria-label="Nota removida fora do MirrorMind"]')).not.toBeDisplayed()

    // A interface lista as duas notas e abre a primeira no editor.
    await expect($(`[aria-label="Abrir nota ${localNote}"]`)).toBeDisplayed()
    await expect($(`[aria-label="Abrir nota ${removedNote}"]`)).toBeDisplayed()
    await $('[aria-label="Abrir nota ' + localNote + '"]').click()
    await waitForEditorText(secondExternal)
    // O rascunho mantido nao sobrescreveu a versao externa escolhida.
    expect(readFileSync(localNotePath, 'utf8')).not.toContain(firstDraft)
  })
})
