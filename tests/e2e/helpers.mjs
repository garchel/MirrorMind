import { $, browser, expect } from '@wdio/globals'
import { existsSync, readFileSync } from 'node:fs'

/** Ajudantes compartilhados das jornadas E2E (antes copiados em cada spec).
 *
 * Centraliza os gestos comuns (esperar o plugin, criar vault, digitar no
 * CodeMirror, esperar arquivo/texto) para que correções como a do modo
 * Edição ou o foco antes de digitar sejam feitas uma única vez. */

// Jornada sem acentos de proposito: os timeoutMsgs seguem o padrao ASCII do
// repositorio; as strings da UI (seletores) mantem o pt-BR.

export async function waitForTauriPlugin() {
  await browser.waitUntil(
    async () => browser.execute(() => 'wdioTauri' in window),
    { timeout: 15_000, timeoutMsg: 'O plugin WebdriverIO nao foi inicializado.' },
  )
}

export async function waitForEditorText(expectedText) {
  // Comparacao por PALAVRA, nao por byte: no modo Misto o CodeMirror insere
  // elementos de decoracao (markers de titulo, listas) e o textContent pode
  // sair com espacos diferentes do markdown digitado. Comparar o texto
  // colapsado verifica o que importa (o conteudo nao se perdeu) sem falhar por
  // espaco de renderizacao — era essa a fonte da falha intermitente.
  const colapsar = (texto) => texto.trim().split(/\s+/).join(' ')
  const esperado = colapsar(expectedText)
  await browser.waitUntil(
    async () => {
      const texto = await browser.execute(() => {
        const editor = document.querySelector('[aria-label^="Editor de texto"]')
        if (!editor) return null
        const quebra = String.fromCharCode(10)
        const linhas = Array.from(editor.querySelectorAll('.cm-line'))
        if (linhas.length > 0) return linhas.map((linha) => linha.textContent ?? '').join(quebra)
        return editor.innerText ?? ''
      })
      if (typeof texto !== 'string') return false
      return colapsar(texto) === esperado
    },
    { timeout: 20_000, interval: 250, timeoutMsg: `O editor nao exibiu o conteudo esperado: ${expectedText}` },
  )
}

export async function waitForFile(path, predicate, timeoutMsg) {
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

export async function waitForMissing(path, timeoutMsg) {
  await browser.waitUntil(
    () => !existsSync(path),
    { timeout: 20_000, timeoutMsg },
  )
}

// Digitacao explicita no CodeMirror: foca, seleciona tudo, apaga e digita. O
// `setValue` do WebdriverIO nao tipa de forma confiavel no contenteditable.
// Remounts (troca de modo/aba) podem roubar o foco entre a consulta e o
// clique: so digita com o foco confirmado dentro do editor.
export async function typeIntoEditor(content) {
  const editor = await $('[aria-label^="Editor de texto"]')
  await editor.click()
  await browser.waitUntil(
    async () => browser.execute(() => {
      const target = document.querySelector('[aria-label^="Editor de texto"]')
      return !!target && target.contains(document.activeElement)
    }),
    { timeout: 5_000, timeoutMsg: 'O editor nao recebeu foco antes da digitacao.' },
  )
  await browser.keys(['Control', 'a'])
  await browser.keys('Delete')
  await editor.addValue(content)
  await waitForEditorText(content)
}

export async function createVault(vaultName) {
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

export async function openContextMenu(element) {
  await browser.execute((target) => {
    const bounds = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }))
  }, element)
}

export async function selectEditorMode(modeElement, mode) {
  // O controle de modo e um grupo de radios (Edição/Misto/Leitura): clica
  // no radio correspondente.
  const labels = { edit: 'Edição', mixed: 'Misto', read: 'Leitura' }
  const radio = modeElement.$(`.//button[normalize-space()="${labels[mode]}"]`)
  await expect(radio).toBeDisplayed()
  await radio.click()
}

// Fechamento pelo SO (WM_CLOSE) mora em window-close-os.mjs: aquele modulo nao
// importa @wdio/globals e por isso tambem roda no probe nativo, sem sessao.
export {
  appProcessIds as appProcessIdsOf,
  requestWindowCloseFromOs,
  waitForProcessExit,
  waitForWindow,
} from './window-close-os.mjs'

/** PID(s) do app E2E em execucao (filtra pelo binario publicado pelo conf). */
export async function appProcessIds() {
  const { appProcessIds: ids } = await import('./window-close-os.mjs')
  const appBinary = process.env.MIRRORMIND_E2E_APP_BINARY
  if (!appBinary) throw new Error('MIRRORMIND_E2E_APP_BINARY nao foi publicado pelo wdio.conf.')
  return ids(appBinary)
}

/** Abre a pagina de Configuracoes.
 *
 *  Ela saiu do trilho e passou a viver no menu do rodape de perfil; clicar em
 *  `[aria-label="Configurações"]` direto nao encontra nada. Os specs quebraram
 *  todos nesse ponto quando o botao mudou de lugar.
 */
export async function openSettings() {
  await $('[aria-label^="Abrir menu do perfil"]').click()
  const item = await $('.//button[normalize-space()="Configurações"]')
  await expect(item).toBeDisplayed({ wait: 10_000 })
  await item.click()
}
