import { $, browser, expect } from '@wdio/globals'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { waitForTauriPlugin } from './helpers.mjs'

const phase = process.env.MIRRORMIND_E2E_PHASE
const supportedPhases = ['sync-conflicts']

if (!supportedPhases.includes(phase)) throw new Error(`Unexpected sync-conflicts E2E phase: ${phase}`)

const VAULT_NAME = 'Vault Sync E2E'
const NOTE_NAME = 'nota.md'
const COPY_NAME = 'nota (conflicted copy abc).md'
const ORIGINAL_CONTENT = '# Nota\n\nConteudo original.'
const COPY_CONTENT = '# Nota\n\nVersao da nuvem.'

if (phase === 'sync-conflicts') describe('Copias de conflito de sincronizacao', () => {
  it('esconde a copia do inventario e resolve pelo dialogo (abrir e substituir)', async () => {
    await waitForTauriPlugin()
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, VAULT_NAME)
    mkdirSync(vaultPath, { recursive: true })
    writeFileSync(join(vaultPath, NOTE_NAME), ORIGINAL_CONTENT)
    writeFileSync(join(vaultPath, COPY_NAME), COPY_CONTENT)

    // Abre o vault existente via E2E (marcador lido pelo build e2e).
    writeFileSync(
      join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'e2e-existing-vault.json'),
      JSON.stringify(vaultPath),
    )
    const openCard = await $('article.action-card')
    await expect(openCard).toBeDisplayed()
    await openCard.$('.//button[normalize-space()="Escolher pasta"]').click()
    await expect($('.workspace-shell')).toBeDisplayed()
    await browser.waitUntil(
      async () => (await $('.workspace-title').getText()).includes(VAULT_NAME),
      { timeout: 20_000, timeoutMsg: 'O scan inicial do Vault nao foi concluido.' },
    )

    // A copia nao vira nota no explorador (saiu do inventario)...
    await expect($('[aria-label="Abrir nota nota"]')).toBeDisplayed()
    await expect($('[aria-label="Abrir nota nota (conflicted copy abc)"]')).not.toExist()
    // ...mas aparece no aviso de conflitos.
    await $('[aria-label^="Resolver"]').click()
    // `<dialog>` nativo (top-layer): o displayedness do WebDriver nao o
    // enxerga — espera pela propriedade `open` em vez de visibilidade.
    // Timeout generoso: a abertura compete com o scan/index iniciais.
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.sync-conflicts-modal')?.open),
      { timeout: 60_000, timeoutMsg: 'O dialogo de conflitos nao abriu.' },
    )
    const dialog = await $('.sync-conflicts-modal')
    await browser.waitUntil(
      async () => ((await dialog.getText()) ?? '').includes('nota.md'),
      { timeout: 10_000, timeoutMsg: 'O dialogo nao listou a copia.' },
    )

    // Abrir copia navega ate ela mesmo fora do inventario.
    await dialog.$('.//button[normalize-space()="Abrir cópia"]').click()
    await browser.waitUntil(
      async () => {
        const tabs = await $$('[role="tab"]')
        for (const tab of tabs) {
          if ((await tab.getText()).includes('conflicted copy')) return true
        }
        return false
      },
      { timeout: 10_000, timeoutMsg: 'A aba da copia nao abriu.' },
    )

    // Substituir grava o conteudo da copia no original e manda a copia para a lixeira.
    await $('[aria-label^="Resolver"]').click()
    const reopened = await $('.sync-conflicts-modal')
    await browser.waitUntil(
      async () => browser.execute(() => !!document.querySelector('.sync-conflicts-modal')?.open),
      { timeout: 60_000, timeoutMsg: 'O dialogo de conflitos nao reabriu.' },
    )
    await reopened.$('.//button[normalize-space()="Substituir"]').click()
    await reopened.$('.//button[normalize-space()="Confirmar substituição"]').click()
    await browser.waitUntil(
      () => {
        try {
          return readFileSync(join(vaultPath, NOTE_NAME), 'utf8').includes('Versao da nuvem')
        } catch {
          return false
        }
      },
      { timeout: 20_000, timeoutMsg: 'O original nao recebeu o conteudo da copia.' },
    )
    expect(existsSync(join(vaultPath, COPY_NAME))).toBe(false)
    await browser.waitUntil(
      async () => !(await $('[aria-label^="Resolver"]').isExisting()),
      { timeout: 20_000, timeoutMsg: 'O aviso de conflito nao sumiu apos resolver.' },
    )
  })
})
