import { $, browser, expect } from '@wdio/globals'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'trash-restore-state.json')
const supportedPhases = ['trash-and-restore', 'verify-trash-restore']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected trash/restore E2E phase: ${phase}`)

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

function trashEntries(root) {
  const trashRoot = join(root, '.mirmind', 'trash')
  if (!existsSync(trashRoot)) return []
  return readdirSync(trashRoot)
}

function trashJson(root) {
  const path = join(root, '.mirmind', 'trash.json')
  if (!existsSync(path)) return []
  return JSON.parse(readFileSync(path, 'utf8'))
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

async function openContextMenu(element) {
  await browser.execute((target) => {
    const bounds = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }))
  }, element)
}

async function sendNoteToTrash(noteName, noteLabel) {
  const note = await $(`[aria-label="Abrir nota ${noteLabel}"]`)
  await expect(note).toBeDisplayed()
  await openContextMenu(note)
  const noteMenu = await $('[aria-label="Acoes para ' + noteName + '"]')
  await expect(noteMenu).toBeDisplayed()
  await noteMenu.$('.//button[normalize-space()="Enviar para lixeira"]').click()
  const deleteDialog = await $('[aria-label="Excluir nota"]')
  await expect(deleteDialog).toBeDisplayed()
  await deleteDialog.$('.//button[normalize-space()="Mover para lixeira"]').click()
}

if (phase === 'trash-and-restore') describe('Lixeira e restauracao', () => {
  it('move para a lixeira, lista, restaura e nunca sobrescreve um item existente', async () => {
    const vaultName = 'Vault Lixeira E2E'
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const noteA = 'nota-a'
    const noteB = 'nota-b'
    const noteAPath = join(vaultPath, `${noteA}.md`)
    const noteBPath = join(vaultPath, `${noteB}.md`)
    const contentA = 'Conteudo original da nota A.'
    const contentB = 'Conteudo original da nota B.'
    const replacementContent = 'Conteudo substituto criado depois da exclusao.'

    await waitForTauriPlugin()
    await createVault(vaultName)

    // Notas preparadas no vault real antes da interacao com a interface.
    writeFileSync(noteAPath, contentA)
    writeFileSync(noteBPath, contentB)
    await $('[aria-label="Atualizar explorador de arquivos"]').click()
    await expect($(`[aria-label="Abrir nota ${noteA}"]`)).toBeDisplayed()
    await expect($(`[aria-label="Abrir nota ${noteB}"]`)).toBeDisplayed()

    // 1. Excluir nota A pela interface (menu de contexto + confirmacao).
    await sendNoteToTrash(`${noteA}.md`, noteA)
    await waitForMissing(noteAPath, 'A nota excluida nao saiu do vault.')
    await browser.waitUntil(
      () => trashEntries(vaultPath).length === 1,
      { timeout: 20_000, timeoutMsg: 'A lixeira nao registrou exatamente um arquivo.' },
    )

    // 2. A pagina da lixeira lista o item com o caminho original.
    await $('[aria-label="Abrir lixeira"]').click()
    const trashPage = await $('.trash-page')
    await expect(trashPage).toBeDisplayed()
    await expect(trashPage).toHaveText(expect.stringContaining(noteA))
    await expect($$('.trash-table-actions')).toBeElementsArrayOfSize(1)

    // 3. Restaurar devolve o arquivo ao local original com os mesmos bytes.
    await $('[aria-label="Restaurar item"]').click()
    await waitForFile(noteAPath, (content) => content === contentA, 'A restauracao nao devolveu os bytes originais.')
    await expect($('.trash-page')).toHaveText(expect.stringContaining('A lixeira esta vazia.'))

    // 4. Excluir nota B e criar um novo arquivo no mesmo caminho: a
    // restauracao nao pode sobrescrever o item existente.
    await $('[aria-label="Voltar para notas"]').click()
    await sendNoteToTrash(`${noteB}.md`, noteB)
    await waitForMissing(noteBPath, 'A segunda nota excluida nao saiu do vault.')
    writeFileSync(noteBPath, replacementContent)
    await $('[aria-label="Abrir lixeira"]').click()
    await $('[aria-label="Restaurar item"]').click()
    // A restauracao recusa sem sobrescrever: erro exibido, o arquivo novo
    // permanece intacto no local original e o item segue na lixeira.
    await expect($('.error-banner')).toBeDisplayed({ wait: 10_000 })
    expect(readFileSync(noteBPath, 'utf8')).toBe(replacementContent)
    expect(trashJson(vaultPath).length).toBe(1)

    // 5. Depois que o conflito e resolvido, restaurar de novo tem sucesso.
    rmSync(noteBPath)
    await $('[aria-label="Restaurar item"]').click()
    await waitForFile(noteBPath, (content) => content === contentB, 'A restauracao apos o conflito falhou.')
    // O registro da lixeira fica vazio: arquivo e metadados removidos.
    await browser.waitUntil(
      () => trashEntries(vaultPath).length === 0 && trashJson(vaultPath).length === 0,
      { timeout: 20_000, timeoutMsg: 'O registro da lixeira nao foi limpo apos restaurar tudo.' },
    )

    writeFileSync(journeyStatePath, JSON.stringify({
      contentA,
      contentB,
      noteA,
      noteB,
      vaultName,
    }))
  })
})

if (phase === 'verify-trash-restore') describe('Reabrir apos lixeira e restauracao', () => {
  it('reabre com os bytes restaurados e sem itens remanescentes na lixeira', async () => {
    const { contentA, contentB, noteA, noteB, vaultName } = JSON.parse(
      readFileSync(journeyStatePath, 'utf8'),
    )
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const noteAPath = join(vaultPath, `${noteA}.md`)
    const noteBPath = join(vaultPath, `${noteB}.md`)

    await waitForTauriPlugin()
    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(vaultName))
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-title')).toHaveText(vaultName)
    // Os bytes restaurados persistiram entre processos.
    expect(readFileSync(noteAPath, 'utf8')).toBe(contentA)
    expect(readFileSync(noteBPath, 'utf8')).toBe(contentB)
    expect(trashEntries(vaultPath)).toEqual([])
    expect(trashJson(vaultPath)).toEqual([])

    // A interface lista as duas notas restauradas e abre a nota A no editor.
    await expect($(`[aria-label="Abrir nota ${noteA}"]`)).toBeDisplayed()
    await expect($(`[aria-label="Abrir nota ${noteB}"]`)).toBeDisplayed()
    await $('[aria-label="Abrir nota ' + noteA + '"]').click()
    const editor = await $('[aria-label^="Editor Markdown"]')
    await expect(editor).toBeDisplayed()
    await browser.waitUntil(
      async () => (await editor.isExisting())
        && await browser.execute((target) => (
          Array.from(target.querySelectorAll('.cm-line'))
            .map((line) => line.textContent ?? '')
            .join('\n')
        ), editor).then((text) => text.replace(/\r\n/g, '\n').trimEnd()) === contentA.replace(/\r\n/g, '\n'),
      { timeout: 15_000, timeoutMsg: 'O editor nao exibiu o conteudo restaurado da nota A.' },
    )
  })
})
