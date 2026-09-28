import { $, browser, expect } from '@wdio/globals'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createVault,
  openContextMenu,
  selectEditorMode,
  typeIntoEditor,
  waitForEditorText,
  waitForFile,
  waitForTauriPlugin,
} from './helpers.mjs'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'rename-move-state.json')
const supportedPhases = ['rename-and-move', 'verify-rename-and-move']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected rename/move E2E phase: ${phase}`)

async function saveEditorText(path, content) {
  // Remounts (troca de modo/aba) e corridas com o autosave/watcher podem
  // invalidar a digitacao: tenta ate 3 vezes antes de desistir.
  let typed = false
  for (let attempt = 0; attempt < 3 && !typed; attempt += 1) {
    try {
      await typeIntoEditor(content)
      typed = true
    } catch {
      if (attempt === 2) throw new Error(`O editor nao exibiu o conteudo esperado apos 3 tentativas: ${content}`)
    }
  }
  // O atalho Ctrl+S so salva quando o estado sujo ja foi commitado pelo React:
  // espera o editor refletir o conteudo digitado antes de enviar a tecla.
  await waitForEditorText(content)
  await browser.keys(['Control', 's'])
  await waitForFile(
    path,
    (persistedContent) => persistedContent === content,
    `A aba remapeada nao salvou no caminho final: ${path}`,
  )
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
    const noteMenu = await $('[aria-label="Ações para aula.md"]')
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
    const editorMode = await $('[aria-label="Modo de visualização da nota"]')
    await selectEditorMode(editorMode, 'edit')
    await expect(editorMode.$('.//button[normalize-space()="Edição"]')).toHaveAttribute('aria-checked', 'true')
    await waitForEditorText(targetContent)
    await saveEditorText(join(noteDestination, 'resumo.md'), movedTabContent)

    const materialTab = await $('[role="tab"]*=material-interno.md')
    await materialTab.click()
    await expect($('.editor-title-button')).toHaveText('material-interno')

    const currentCourseFolder = await $('[aria-label="Pasta curso"]')
    await openContextMenu(currentCourseFolder)
    const folderMenu = await $('[aria-label="Ações para curso"]')
    await folderMenu.$('.//button[normalize-space()="Renomear"]').click()
    const renameFolderDialog = await $('[aria-label="Renomear pasta"]')
    await renameFolderDialog.$('[aria-label="Novo nome"]').setValue('estudos')
    await renameFolderDialog.$('.//button[normalize-space()="Renomear"]').click()

    await waitForFile(referencePath, (content) => content.includes('[[estudos/sub/material-interno]]'), 'O rename da pasta nao atualizou seus links.')
    expect(existsSync(sourceFolder)).toBe(false)
    await expect($('[aria-label="Pasta estudos"]')).toBeDisplayed()

    const studiesFolder = await $('[aria-label="Pasta estudos"]')
    await openContextMenu(studiesFolder)
    const studiesMenu = await $('[aria-label="Ações para estudos"]')
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
    // O salvamento pelo atalho exige o editor em modo Edicao (o modo Misto
    // nao propaga a entrada programatica do WebdriverIO como sujeira).
    const nestedEditorMode = await $('[aria-label="Modo de visualização da nota"]')
    await selectEditorMode(nestedEditorMode, 'edit')
    await expect(nestedEditorMode.$('.//button[normalize-space()="Edição"]')).toHaveAttribute('aria-checked', 'true')
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
    const editorMode = await $('[aria-label="Modo de visualização da nota"]')
    await selectEditorMode(editorMode, 'edit')
    await expect(editorMode.$('.//button[normalize-space()="Edição"]')).toHaveAttribute('aria-checked', 'true')
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
