import { $, browser, expect } from '@wdio/globals'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'rename-move-state.json')
const supportedPhases = ['rename-and-move', 'verify-rename-and-move']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected rename/move E2E phase: ${phase}`)

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

async function saveEditorText(path, content) {
  const editor = await $('[aria-label^="Editor Markdown"]')
  await editor.setValue(content)
  await $('.editor-title-button').click()
  await browser.keys(['Control', 's'])
  await waitForFile(
    path,
    (persistedContent) => persistedContent === content,
    `A aba remapeada nao salvou no caminho final: ${path}`,
  )
}

async function selectEditorMode(modeElement, mode) {
  await browser.execute((target, value) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    valueSetter?.call(target, value)
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }, modeElement, mode)
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
    async () => (await $('.workspace-status').getText()).includes('Vault carregado'),
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

async function dropNoteInFolder(sourcePath, folderElement) {
  await browser.execute((target, path) => {
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('application/x-mirrormind-note', path)
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }))
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    }))
  }, folderElement, sourcePath)
}

if (phase === 'rename-and-move') describe('Renomear e mover com links', () => {
  it('remapeia notas, pastas, links e abas sem perder bytes', async () => {
    const vaultName = 'Vault Rename Move E2E'
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const sourceFolder = join(vaultPath, 'curso')
    const noteDestination = join(vaultPath, 'destino-nota')
    const folderDestination = join(vaultPath, 'arquivo')
    const targetContent = '# Aula\n\nConteudo alvo.'
    const nestedContent = '# Material interno'
    const movedTabContent = `${targetContent}\n\nAba remapeada.`
    const movedNestedTabContent = `${nestedContent}\n\nAba remapeada.`
    const initialReferences = '[[curso/aula|Aula]]\n![[curso/sub/material-interno]]'
    const renamedReferences = '[[curso/resumo|Aula]]\n![[curso/sub/material-interno]]'
    const noteMovedReferences = '[[destino-nota/resumo|Aula]]\n![[curso/sub/material-interno]]'
    const finalReferences = '[[destino-nota/resumo|Aula]]\n![[arquivo/estudos/sub/material-interno]]'
    const referencePath = join(vaultPath, 'referencias.md')

    await waitForTauriPlugin()
    await createVault(vaultName)

    mkdirSync(join(sourceFolder, 'sub'), { recursive: true })
    mkdirSync(noteDestination)
    mkdirSync(folderDestination)
    writeFileSync(join(sourceFolder, 'aula.md'), targetContent)
    writeFileSync(join(sourceFolder, 'sub', 'material-interno.md'), nestedContent)
    writeFileSync(referencePath, initialReferences)
    await $('[aria-label="Atualizar explorador de arquivos"]').click()

    const courseFolder = await $('[aria-label="Pasta curso"]')
    await expect(courseFolder).toBeDisplayed()
    await courseFolder.click()
    await $('[aria-label="Pasta sub"]').click()

    await $('[aria-label="Abrir nota referencias"]').click()
    await $('[aria-label="Abrir nota material-interno"]').click()
    await $('[aria-label="Abrir nota aula"]').click()
    await expect($$('[role="tab"]')).toBeElementsArrayOfSize(3)

    const sourceNote = await $('[aria-label="Abrir nota aula"]')
    await openContextMenu(sourceNote)
    const noteMenu = await $('[aria-label="Acoes para aula.md"]')
    await expect(noteMenu).toBeDisplayed()
    await noteMenu.$('.//button[normalize-space()="Renomear"]').click()
    const renameNoteDialog = await $('[aria-label="Renomear nota"]')
    await renameNoteDialog.$('[aria-label="Novo nome"]').setValue('resumo')
    await renameNoteDialog.$('.//button[normalize-space()="Renomear"]').click()

    await waitForFile(referencePath, (content) => content === renamedReferences, 'O rename nao atualizou o wikilink da nota.')
    expect(existsSync(join(sourceFolder, 'aula.md'))).toBe(false)
    expect(readFileSync(join(sourceFolder, 'resumo.md'), 'utf8')).toBe(targetContent)
    await expect($('[role="tab"]*=resumo.md')).toBeDisplayed()

    const renamedNote = await $('[aria-label="Abrir nota resumo"]')
    await expect(renamedNote).toBeDisplayed()
    const noteDestinationFolder = await $('[aria-label="Pasta destino-nota"]')
    await dropNoteInFolder('curso/resumo.md', noteDestinationFolder)

    await waitForFile(referencePath, (content) => content === noteMovedReferences, 'O move nao atualizou o wikilink da nota.')
    expect(existsSync(join(sourceFolder, 'resumo.md'))).toBe(false)
    expect(readFileSync(join(noteDestination, 'resumo.md'), 'utf8')).toBe(targetContent)
    const movedNoteTab = await $('[role="tab"]*=resumo.md')
    await movedNoteTab.click()
    await expect($('.editor-title-button')).toHaveText('resumo')
    const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
    await selectEditorMode(editorMode, 'edit')
    await expect(editorMode).toHaveValue('edit')
    await waitForEditorText(targetContent)
    await saveEditorText(join(noteDestination, 'resumo.md'), movedTabContent)

    const materialTab = await $('[role="tab"]*=material-interno.md')
    await materialTab.click()
    await expect($('.editor-title-button')).toHaveText('material-interno')

    const currentCourseFolder = await $('[aria-label="Pasta curso"]')
    await openContextMenu(currentCourseFolder)
    const folderMenu = await $('[aria-label="Acoes para curso"]')
    await folderMenu.$('.//button[normalize-space()="Renomear"]').click()
    const renameFolderDialog = await $('[aria-label="Renomear pasta"]')
    await renameFolderDialog.$('[aria-label="Novo nome"]').setValue('estudos')
    await renameFolderDialog.$('.//button[normalize-space()="Renomear"]').click()

    await waitForFile(referencePath, (content) => content.includes('[[estudos/sub/material-interno]]'), 'O rename da pasta nao atualizou seus links.')
    expect(existsSync(sourceFolder)).toBe(false)
    await expect($('[aria-label="Pasta estudos"]')).toBeDisplayed()

    const studiesFolder = await $('[aria-label="Pasta estudos"]')
    await openContextMenu(studiesFolder)
    const studiesMenu = await $('[aria-label="Acoes para estudos"]')
    await studiesMenu.$('.//button[normalize-space()="Mover pasta"]').click()
    const moveFolderDialog = await $('[aria-label="Mover pasta"]')
    await moveFolderDialog.$('[aria-label="Pasta de destino"]').setValue('arquivo')
    await moveFolderDialog.$('.//button[normalize-space()="Mover"]').click()

    await waitForFile(referencePath, (content) => content === finalReferences, 'O move da pasta nao atualizou todos os wikilinks.')
    const finalNestedPath = join(folderDestination, 'estudos', 'sub', 'material-interno.md')
    expect(readFileSync(finalNestedPath, 'utf8')).toBe(nestedContent)
    expect(existsSync(join(vaultPath, 'estudos'))).toBe(false)
    await expect($('[role="tab"]*=material-interno.md')).toHaveAttribute('aria-selected', 'true')
    await expect($('.editor-title-button')).toHaveText('material-interno')
    await waitForEditorText(nestedContent)
    await saveEditorText(finalNestedPath, movedNestedTabContent)

    writeFileSync(journeyStatePath, JSON.stringify({
      finalReferences,
      nestedContent: movedNestedTabContent,
      targetContent: movedTabContent,
      vaultName,
    }))
  })
})

if (phase === 'verify-rename-and-move') describe('Reabrir rename e move', () => {
  it('reabre somente os caminhos finais e preserva links e conteudo', async () => {
    const { finalReferences, nestedContent, targetContent, vaultName } = JSON.parse(
      readFileSync(journeyStatePath, 'utf8'),
    )
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const referencePath = join(vaultPath, 'referencias.md')
    const movedNotePath = join(vaultPath, 'destino-nota', 'resumo.md')
    const movedNestedPath = join(vaultPath, 'arquivo', 'estudos', 'sub', 'material-interno.md')

    await waitForTauriPlugin()
    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(vaultName))
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-title')).toHaveText(vaultName)
    expect(readFileSync(referencePath, 'utf8')).toBe(finalReferences)
    expect(readFileSync(movedNotePath, 'utf8')).toBe(targetContent)
    expect(readFileSync(movedNestedPath, 'utf8')).toBe(nestedContent)
    expect(existsSync(join(vaultPath, 'curso'))).toBe(false)
    expect(existsSync(join(vaultPath, 'estudos'))).toBe(false)
    expect(existsSync(join(vaultPath, 'aula.md'))).toBe(false)

    await $('[aria-label="Pasta destino-nota"]').click()
    await $('[aria-label="Abrir nota resumo"]').click()
    const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
    await selectEditorMode(editorMode, 'edit')
    await expect(editorMode).toHaveValue('edit')
    await waitForEditorText(targetContent)

    await $('[aria-label="Pasta arquivo"]').click()
    await $('[aria-label="Pasta estudos"]').click()
    await $('[aria-label="Pasta sub"]').click()
    await $('[aria-label="Abrir nota material-interno"]').click()
    await waitForEditorText(nestedContent)

    await $('[aria-label="Abrir nota referencias"]').click()
    await waitForEditorText(finalReferences)
  })
})
