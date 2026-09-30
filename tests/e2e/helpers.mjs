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
  const editor = await $('[aria-label^="Editor Markdown"]')
  await editor.click()
  await browser.waitUntil(
    async () => browser.execute(() => {
      const target = document.querySelector('[aria-label^="Editor Markdown"]')
      return !!target && target.contains(document.activeElement)
    }),
    { timeout: 5_000, timeoutMsg: 'O editor nao recebeu foco antes da digitacao.' },
  )
  // O `Control+a` precisa ser CONFIRMADO, nao presumido. Medido no runner do
  // CI (run 36776222701): `keys(['Control','a'])` e assincrono e chegava
  // depois do `addValue`, entao a digitacao era CONCATENADA ao texto antigo
  // em vez de substitui-lo. O sintoma enganava: editor e arquivo ficavam
  // coerentes entre si, ambos com o conteudo da digitacao anterior, o que
  // parecia app quebrado em vez de teste. Probe confirmou que 400ms depois
  // do atalho a selecao existe e cobre o texto inteiro.
  //
  // O predicate compara o texto selecionado com o conteudo do editor, em vez
  // de so checar `isCollapsed`: em editor VAZIO o `Control+a` nao produz
  // selecao alguma (nao ha o que selecionar), e exigir selecao ali travava o
  // teste. Comparar os dois valores aceita o caso vazio e so espera quando ha
  // texto de verdade para apagar.
  //
  // Sem retry nem skip: se o atalho falhar, a mensagem de timeout nomeia a
  // causa em vez de mascarar.
  await browser.keys(['Control', 'a'])
  await browser.waitUntil(
    async () => browser.execute(() => {
      const target = document.querySelector('[aria-label^="Editor Markdown"]')
      if (!target) return false
      const current = Array.from(target.querySelectorAll('.cm-line'))
        .map((line) => line.textContent ?? '')
        .join('\n')
      if (current.trim() === '') return true
      const selection = target.ownerDocument.getSelection()
      return !!selection && !selection.isCollapsed && String(selection) === current
    }),
    { timeout: 5_000, timeoutMsg: 'O Control+a nao selecionou o conteudo do editor antes de digitar.' },
  )
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
