import { $, browser, expect } from '@wdio/globals'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
const journeyStatePath = join(process.env.MIRRORMIND_E2E_RUN_ROOT, 'journey-state.json')

if (!['goals-create', 'verify-goals'].includes(phase)) throw new Error(`Unexpected E2E phase: ${phase}`)

// Jornada sem acentos de proposito: os timeoutMsgs dos .e2e.mjs seguem o
// padrao ASCII do repositorio; as strings da UI (seletores) mantem o pt-BR.
const vaultName = 'Vault Metas E2E'
const goalTitle = 'Aprender fotossintese E2E'

async function waitForApp() {
  await browser.waitUntil(
    async () => browser.execute(() => 'wdioTauri' in window),
    { timeout: 15_000, timeoutMsg: 'O plugin WebdriverIO nao foi inicializado no frontend.' },
  )
}

async function createVault() {
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

async function openGoals() {
  await $('[aria-label="Abrir metas de aprendizado"]').click()
  await expect($('.goals-page')).toBeDisplayed()
}

if (phase === 'goals-create') describe('Metas: criar e concluir passo', () => {
  it('cria a meta com plano deterministico e conclui o primeiro passo', async () => {
    await waitForApp()
    await createVault()
    await openGoals()

    await $('.goals-page').$('.//button[normalize-space()="Nova meta"]').click()
    const dialog = await $('dialog.goals-dialog')
    await expect(await dialog.$('#goals-title-input')).toBeDisplayed()
    await dialog.$('#goals-title-input').setValue(goalTitle)
    await dialog.$('#goals-objective-input').setValue('Explicar o processo sem consultar e resolver exercicios.')
    await dialog.$('#goals-source-input').setValue('# Capitulo 1\n\n# Capitulo 2\n')

    // Sem IA: o plano sai do fatiamento local do texto-fonte (deterministico,
    // sem rede nem provedor configurado).
    const useAi = await dialog.$('#goals-use-ai')
    if (await useAi.isSelected()) await useAi.click()

    await dialog.$('.//button[contains(normalize-space(),"Criar meta")]').click()

    const firstStepGroup = await $('[aria-label^="Status do passo 1:"]')
    await browser.waitUntil(
      async () => firstStepGroup.isExisting(),
      { timeout: 30_000, timeoutMsg: 'O plano da meta nao foi gerado.' },
    )
    await expect($('.goals-list')).toHaveText(expect.stringContaining(goalTitle))

    await firstStepGroup.$('.//button[normalize-space()="Concluído"]').click()
    await browser.waitUntil(
      async () => (await $(`[aria-label="Progresso da meta ${goalTitle}: 1 de 2 passos concluídos"]`).isExisting()),
      { timeout: 20_000, timeoutMsg: 'O passo concluido nao refletiu no progresso.' },
    )

    writeFileSync(journeyStatePath, JSON.stringify({ goalTitle, vaultName }))
  })
})

if (phase === 'verify-goals') describe('Metas: persistencia apos reinicio', () => {
  it('reabre o vault e mantem a meta com o passo concluido', async () => {
    const { goalTitle: savedTitle, vaultName: savedVault } = JSON.parse(readFileSync(journeyStatePath, 'utf8'))
    await waitForApp()

    const recentVaultDialog = await $('.recent-vault-modal')
    await expect(recentVaultDialog).toBeDisplayed()
    await expect(recentVaultDialog).toHaveText(expect.stringContaining(savedVault))
    await recentVaultDialog.$('.//button[normalize-space()="Usar este vault"]').click()

    await expect($('.workspace-shell')).toBeDisplayed()
    await openGoals()

    await expect($('.goals-list')).toHaveText(expect.stringContaining(savedTitle))
    await browser.waitUntil(
      async () => (await $(`[aria-label="Progresso da meta ${savedTitle}: 1 de 2 passos concluídos"]`).isExisting()),
      { timeout: 20_000, timeoutMsg: 'A meta nao persistiu entre processos.' },
    )
  })
})
