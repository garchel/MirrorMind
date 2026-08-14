import { $, browser, expect } from '@wdio/globals'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'attachment-state.json')
const supportedPhases = ['attachment-complete', 'verify-attachment']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected attachment E2E phase: ${phase}`)

const VAULT_NAME = 'Vault Anexo E2E'
const NOTE_RELATIVE_PATH = 'materias/aula.md'
// Conteudo base digitado no editor: o cursor fica no FIM apos a digitacao, o
// que torna deterministica a posicao do embed inserido pelo drop.
const BASE_CONTENT = 'Conteudo da aula com anexos.'
const EMBEDDED_CONTENT = '# Aula\n\nConteudo da aula com anexos.\n\n![[grafico.png]]'
// PNG 1x1 valido (bytes fixos): renderiza de verdade no modo Leitura.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const TXT_CONTENT = 'Conteudo do anexo de texto.'

// Emite o mesmo evento nativo que o arrastar-e-soltar real do SO produz: o
// frontend escuta `tauri://drag-drop` via `getCurrentWindow().onDragDropEvent`.
async function dropFileIntoEditor(sourcePath) {
  const editor = await $('[aria-label^="Editor Markdown"]')
  const position = await browser.execute((target) => {
    const bounds = target.getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  }, editor)
  await browser.execute((args) => (
    window.__TAURI__.event.emit('tauri://drag-drop', { paths: [args.sourcePath], position: args.position })
  ), { sourcePath, position })
}

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

async function waitForFileBytes(path, predicate, timeoutMsg) {
  await browser.waitUntil(
    () => {
      try {
        return predicate(readFileSync(path))
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

// A ordem dos embeds depende do cursor no momento do drop (controlado pelo
// usuario, nao pelo produto): a assercao verifica que CADA embed inserido
// aponta para o caminho relativo correto, independente da ordem.
async function waitForEditorTextContaining(expectedParts) {
  await browser.waitUntil(
    async () => {
      const editor = await $('[aria-label^="Editor Markdown"]')
      if (!(await editor.isExisting())) return false
      const text = await browser.execute((target) => (
        Array.from(target.querySelectorAll('.cm-line')).map((line) => line.textContent ?? '').join('\n')
      ), editor)
      return expectedParts.every((part) => text.includes(part))
    },
    { timeout: 10_000, timeoutMsg: `O editor nao contem os embeds esperados: ${expectedParts.join(' | ')}` },
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

async function switchToReadMode() {
  const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
  const readButton = editorMode.$('.//button[normalize-space()="Leitura"]')
  await expect(readButton).toBeDisplayed()
  await readButton.click()
  await expect(readButton).toHaveAttribute('aria-checked', 'true')
}

async function expectEmbeddedImageRendered() {
  await browser.waitUntil(
    async () => browser.execute(() => (
      Array.from(document.querySelectorAll('.markdown-reading img'))
        .map((img) => img.getAttribute('src') ?? '')
        .some((src) => src.includes('asset.localhost') && src.includes('grafico.png'))
    )),
    { timeout: 10_000, timeoutMsg: 'A imagem importada nao renderizou no modo Leitura.' },
  )
}

if (phase === 'attachment-complete') describe('Anexo completo', () => {
  it('importa, insere o embed, renderiza e respeita o attachmentFolderPath do Obsidian', async () => {
    await waitForTauriPlugin()
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, VAULT_NAME)
    const sourceRoot = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, 'anexo-src')

    await createVault(VAULT_NAME)

    // Configuracao Obsidian: anexos relativos a pasta da nota (`./media`).
    mkdirSync(join(vaultPath, '.obsidian'), { recursive: true })
    writeFileSync(join(vaultPath, '.obsidian', 'app.json'), JSON.stringify({
      attachmentFolderPath: './media',
    }))

    // Nota suportada em subpasta + arquivos de origem FORA do vault.
    mkdirSync(join(vaultPath, 'materias'), { recursive: true })
    writeFileSync(join(vaultPath, 'materias', 'aula.md'), `# Aula\n\n${BASE_CONTENT}`)
    mkdirSync(sourceRoot, { recursive: true })
    const sourcePng = join(sourceRoot, 'grafico.png')
    const sourceTxt = join(sourceRoot, 'dados.txt')
    writeFileSync(sourcePng, PNG_BYTES)
    writeFileSync(sourceTxt, TXT_CONTENT)
    await $('[aria-label="Atualizar explorador de arquivos"]').click()
    await $('[aria-label="Pasta materias"]').click()
    await $('[aria-label="Abrir nota aula"]').click()

    // Redigita o conteudo para deixar o cursor no FIM (posicao deterministica
    // onde o embed inserido pelo drop vai parar). O modo Edicao propaga a
    // digitacao programatica como sujeira (o Misto nao).
    const editorMode = await $('[aria-label="Modo de visualizacao da nota"]')
    const editButton = editorMode.$('.//button[normalize-space()="Edicao"]')
    await expect(editButton).toBeDisplayed()
    await editButton.click()
    await expect(editButton).toHaveAttribute('aria-checked', 'true')
    await typeIntoEditor(BASE_CONTENT)

    // 1. Importa a imagem pelo drop nativo: destino `materias/media/grafico.png`
    //    (resolvido a partir do `attachmentFolderPath: "./media"` da nota).
    await dropFileIntoEditor(sourcePng)
    const mediaDir = join(vaultPath, 'materias', 'media')
    await waitForFileBytes(
      join(mediaDir, 'grafico.png'),
      (bytes) => bytes.equals(PNG_BYTES),
      'A imagem nao chegou ao destino configurado com os bytes originais.',
    )
    // O embed Markdown foi inserido no editor apontando para o caminho relativo.
    await waitForEditorText(`${BASE_CONTENT}\n\n![grafico.png](materias/media/grafico.png)`)

    // 2. Importa um arquivo de texto (nao imagem): link normal no mesmo destino.
    await dropFileIntoEditor(sourceTxt)
    await waitForFileBytes(
      join(mediaDir, 'dados.txt'),
      (bytes) => bytes.toString('utf8') === TXT_CONTENT,
      'O arquivo de texto nao chegou ao destino configurado.',
    )
    await waitForEditorTextContaining([
      '![grafico.png](materias/media/grafico.png)',
      '[dados.txt](materias/media/dados.txt)',
    ])

    // 3. Salva e confirma que o embed wikilink `![[grafico.png]]` renderiza a
    //    imagem real no modo Leitura (protocolo de asset do Vault).
    await typeIntoEditor(EMBEDDED_CONTENT)
    await browser.keys(['Control', 's'])
    await waitForFile(
      join(vaultPath, NOTE_RELATIVE_PATH),
      (content) => content === EMBEDDED_CONTENT,
      'A nota com o embed nao foi salva.',
    )
    await switchToReadMode()
    await expectEmbeddedImageRendered()

    writeFileSync(journeyStatePath, JSON.stringify({
      embeddedContent: EMBEDDED_CONTENT,
      noteRelativePath: NOTE_RELATIVE_PATH,
      vaultName: VAULT_NAME,
    }))
  })
})

if (phase === 'verify-attachment') describe('Reabrir apos anexo', () => {
  it('reabre com o embed renderizando e os anexos intactos no destino configurado', async () => {
    const { embeddedContent, noteRelativePath, vaultName } = JSON.parse(readFileSync(journeyStatePath, 'utf8'))
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, vaultName)
    const mediaDir = join(vaultPath, 'materias', 'media')

    await waitForTauriPlugin()
    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(vaultName))
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-title')).toHaveText(vaultName)
    expect(readFileSync(join(mediaDir, 'grafico.png')).equals(PNG_BYTES)).toBe(true)
    expect(readFileSync(join(mediaDir, 'dados.txt'), 'utf8')).toBe(TXT_CONTENT)
    expect(existsSync(join(mediaDir, 'grafico.png'))).toBe(true)

    await $('[aria-label="Pasta materias"]').click()
    await $('[aria-label="Abrir nota aula"]').click()
    await switchToReadMode()
    await expectEmbeddedImageRendered()
    expect(readFileSync(join(vaultPath, noteRelativePath), 'utf8')).toBe(embeddedContent)
  })
})
