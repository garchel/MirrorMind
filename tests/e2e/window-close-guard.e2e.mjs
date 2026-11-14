import { $, browser, expect } from '@wdio/globals'
import { appProcessIds, createVault, openSettings, requestWindowCloseFromOs, typeIntoEditor, waitForTauriPlugin } from './helpers.mjs'

/**
 * Fechamento pelo X com uma NOTA NOVA digitada e nao salva.
 *
 * Este e o cenario que o probe nativo (`window-close-native.mjs`) nao alcanca:
 * la nao ha vault, entao nao ha o que perder. Aqui o app esta com texto no
 * editor de uma nota que ainda nao existe no disco — o caso em que fechar sem
 * perguntar destroi trabalho.
 *
 * A janela continua ABERTA no fim (o teste clica em Cancelar): com ela viva, o
 * WebDriver segue podendo assertar. O fechamento que conclui de verdade e o
 * probe nativo, fora do driver.
 */
const supportedPhases = ['window-close-guard']
const phase = process.env.MIRRORMIND_E2E_PHASE

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected window-close-guard phase: ${phase}`)

describe('Fechamento com nota nova nao salva', () => {
  it('o X pergunta antes de sair e Cancelar mantem o texto', async () => {
    const vaultName = 'Vault Guarda Fechamento E2E'
    const TEXTO = 'texto que nao pode sumir'

    await waitForTauriPlugin()
    await createVault(vaultName)

    // Autosave DESLIGADO: com ele ligado o app grava a nota nova em ~650 ms e
    // fechar sem perguntar passa a ser correto (nao ha o que perder). O risco
    // que este teste cobre e o rascunho que so existe na tela.
    await openSettings()
    const autoSave = await $('.settings-toggle*=Salvamento automático').$('input[type="checkbox"]')
    await expect(autoSave).toBeDisplayed()
    if (await autoSave.isSelected()) await autoSave.click()
    await expect(autoSave).not.toBeSelected()
    await $('[aria-label="Voltar para notas"]').click()

    // Nota nova: nenhum arquivo no disco, so a aba de rascunho.
    await $('[aria-label="Nova nota"]').click()
    const titulo = await $('[aria-label="Título da nova nota"]')
    await expect(titulo).toBeDisplayed({ wait: 10_000 })
    await titulo.setValue('Saida')

    const editorMisto = await $('[aria-label^="Editor de texto"]')
    await expect(editorMisto).toBeDisplayed({ wait: 15_000 })
    const modo = await $('[aria-label="Modo de visualização da nota"]')
    const edicao = modo.$('.//button[normalize-space()="Edição"]')
    await edicao.click()
    await expect(edicao).toHaveAttribute('aria-checked', 'true')

    // Teclado de verdade: `addValue` empurra texto para o contenteditable sem
    // necessariamente passar pela transacao do CodeMirror que atualiza o estado
    // do app — e o estado e justamente o que a guarda de fechamento consulta.
    // Mesma digitacao dos outros specs (addValue no contenteditable, com
    // espera pelo texto). O que este teste acrescenta e o pause abaixo.
    await typeIntoEditor(TEXTO)
    const editor = await $('[aria-label^="Editor de texto"]')

    // O estado do app e atualizado em efeito, depois do render: enviar o X no
    // mesmo tick do ultimo caractere mede a corrida, nao a guarda.
    await browser.pause(2_000)

    const pids = await appProcessIds()
    expect(pids.length).toBeGreaterThan(0)
    const pid = pids[0]
    expect(await requestWindowCloseFromOs(pid)).toContain('ENVIADO')
    // O dialogo pode levar um instante depois do evento nativo; o pedido e
    // idempotente (fechar de novo com a janela viva nao faz mal).


    // O Modal do app e um <dialog> NATIVO: o role="dialog" e implicito na arvore
// de acessibilidade, nao um atributo no HTML. Seletor CSS por role nao acha.
const dialog = $('dialog[open]')
    const apareceu = await browser.waitUntil(
      () => dialog.isDisplayed(),
      { timeout: 15_000, timeoutMsg: 'O aviso de alteracoes nao salvas nao apareceu.' },
    ).catch(() => false)

    if (!apareceu) {
      const dump = await browser.execute(() => ({
        dialogs: document.querySelectorAll('dialog[open]').length,
        temAviso: document.body.innerText.includes('alterações não salvas'),
        texto: document.body.innerText.slice(0, 400),
      }))
      console.log('DUMP_DIALOGO', JSON.stringify(dump))
      // Diagnostico: se o processo sumiu, o app fechou descartando o texto;
      // se continua vivo sem dialogo, o handler respondeu mas nao perguntou.
      const vivosDepois = await appProcessIds()
      throw new Error(
        `O X nao perguntou antes de fechar. Processos vivos depois do pedido: ${vivosDepois.length} `
        + `(antes: ${pids.length}).`,
      )
    }

    await expect(dialog).toHaveText(expect.stringContaining('alterações não salvas'))

    // Cancelar: janela e texto continuam.
    await dialog.$('.//button[normalize-space()="Cancelar"]').click()
    await expect(dialog).not.toBeDisplayed({ wait: 10_000 })
    await expect($('[aria-label^="Editor de texto"]')).toBeDisplayed()
    await expect(editor).toHaveText(expect.stringContaining(TEXTO))
    expect(await appProcessIds()).toContain(pid)
  })
})
