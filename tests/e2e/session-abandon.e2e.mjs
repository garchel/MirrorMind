import { $, browser, expect } from '@wdio/globals'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.env.MIRRORMIND_E2E_PHASE
if (phase !== 'session-abandon') throw new Error(`Unexpected E2E phase: ${phase}`)

const VAULT_NAME = 'Vault Abandono E2E'
const NOTE_SLUG = 'revisao-e2e'
const NOTE_CONTENT = [
  'Fotossintese converte energia luminosa em energia quimica.',
  'A clorofila absorve luz nas bandas azul e vermelha.',
  'O processo libera oxigenio como subproduto.',
  'A glicose e o principal produto da fase escura.',
].join('\n')

async function waitForTauriPlugin() {
  await browser.waitUntil(
    async () => browser.execute(() => 'wdioTauri' in window),
    { timeout: 15_000, timeoutMsg: 'O plugin WebdriverIO nao foi inicializado.' },
  )
}

async function createVault() {
  const createCard = await $('article.action-card--accent')
  await expect(createCard).toBeDisplayed()
  await createCard.$('input').setValue(VAULT_NAME)
  await createCard.$('.//button[normalize-space()="Escolher pasta pai"]').click()
  await browser.waitUntil(
    async () => (await createCard.$('small').getText()).includes(VAULT_NAME),
    { timeoutMsg: 'A pasta pai isolada nao foi selecionada.' },
  )
  await createCard.$('.//button[normalize-space()="Criar vault"]').click()
  await expect($('.workspace-shell')).toBeDisplayed()
  await browser.waitUntil(
    async () => (await $('.workspace-title').getText()).includes(VAULT_NAME),
    { timeout: 20_000, timeoutMsg: 'O scan inicial do Vault nao foi concluido.' },
  )
}

function learningDocumentFiles(vaultPath) {
  const learningRoot = join(vaultPath, '.mirmind', 'learning')
  return readdirSync(learningRoot).filter((name) => name.endsWith('.json'))
}

async function seedReviewState(vaultPath) {
  // Semeadura deterministica via backend de dominio (build com --features e2e):
  // a nota fica pronta + inscrita + vencida, com hash real do Markdown.
  await browser.execute(
    (args) => window.__TAURI__.core.invoke('seed_e2e_review_state', args),
    { path: vaultPath, relativePath: `${NOTE_SLUG}.md` },
  )
  await browser.waitUntil(
    () => learningDocumentFiles(vaultPath).length === 1,
    { timeout: 20_000, timeoutMsg: 'O estado semeado nao foi persistido.' },
  )
}

async function openQueuePage() {
  await $('[aria-label="Abrir fila de revisão"]').click()
  await expect($('.review-queue-page')).toBeDisplayed()
  const reviewButton = await $(`[aria-label="Revisar ${NOTE_SLUG}"]`)
  await expect(reviewButton).toBeDisplayed()
}

async function startSession() {
  await $(`[aria-label="Revisar ${NOTE_SLUG}"]`).click()
  await expect($('.review-session-page')).toBeDisplayed()
  const startButton = await $('.review-start')
  await expect(startButton).toBeDisplayed()
  await startButton.click()
  // Prova mista gerada pelo mock: a primeira pergunta aparece com o botao
  // `Nao sei` (modo prova) e o topo mostra "Questao 1 de 3".
  await browser.waitUntil(
    async () => (await $('.review-question').isExisting()) &&
      (await $('.review-session-topbar').getText()).includes('Questão 1 de 3'),
    { timeout: 20_000, timeoutMsg: 'A sessao nao iniciou com o plano de prova do mock.' },
  )
}

async function openAbandonDialog() {
  const dialog = await $('.review-abandon-dialog')
  await browser.waitUntil(
    async () => (await dialog.isExisting()) && (await dialog.isDisplayed()),
    { timeout: 5_000, timeoutMsg: 'O dialogo de abandono nao abriu.' },
  )
  return dialog
}

async function confirmAbandonment() {
  await (await openAbandonDialog()).$('.review-abandon-confirm').click()
}

async function cancelAbandonment() {
  await (await openAbandonDialog()).$('.//button[normalize-space()="Cancelar"]').click()
}

async function assertStillInSession() {
  await expect($('.review-question')).toBeDisplayed()
  await expect($('.review-queue-page')).not.toBeDisplayed()
}

async function assertBackToQueue() {
  await expect($('.review-queue-page')).toBeDisplayed()
  await expect($('.review-question')).not.toBeDisplayed()
}

describe('Abandono nativo de sessao', () => {
  it('prepara um vault com uma nota vencida e inicia uma sessao real com o mock de IA', async () => {
    await waitForTauriPlugin()
    await createVault()
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, VAULT_NAME)
    writeFileSync(join(vaultPath, `${NOTE_SLUG}.md`), NOTE_CONTENT)
    await $('[aria-label="Atualizar explorador de arquivos"]').click()
    await expect($(`[aria-label="Abrir nota ${NOTE_SLUG}"]`)).toBeDisplayed()
    await seedReviewState(vaultPath)
    await openQueuePage()
    await startSession()
  })

  it('o botao Abandonar pede confirmacao e descarta somente ao confirmar', async () => {
    await $('.review-session-topbar .secondary-button').click()

    // Cancelar mantem a sessao ativa.
    await cancelAbandonment()
    await assertStillInSession()

    // Confirmar descarta e volta para a fila.
    await $('.review-session-topbar .secondary-button').click()
    await confirmAbandonment()
    await assertBackToQueue()
  })

  it('a navegacao pela barra de ferramentas pede confirmacao durante a sessao', async () => {
    await startSession()

    // Clique no Painel: o dialogo abre e Cancelar mantem a sessao.
    await $('[aria-label="Abrir painel de aprendizado"]').click()
    await cancelAbandonment()
    await assertStillInSession()

    // Novo clique na barra: confirmar descarta e volta para a fila.
    await $('[aria-label="Abrir painel de aprendizado"]').click()
    await confirmAbandonment()
    await assertBackToQueue()
  })

  it('a troca de Vault pede confirmacao durante a sessao', async () => {
    await startSession()

    await $('.vault-switch-button').click()
    await cancelAbandonment()
    await assertStillInSession()

    await $('.vault-switch-button').click()
    await confirmAbandonment()
    await assertBackToQueue()
  })

  it('nenhum abandono registra sessao nem altera o agendamento', async () => {
    const vaultPath = join(process.env.MIRRORMIND_E2E_VAULT_PARENT, VAULT_NAME)
    const [documentFile] = learningDocumentFiles(vaultPath)
    const document = JSON.parse(readFileSync(join(vaultPath, '.mirmind', 'learning', documentFile), 'utf8'))
    expect(document.sessions).toEqual([])
    // O agendamento continua vencido: a nota segue disponivel na fila.
    expect(document.scheduling.status).toBe('due')
    await openQueuePage()
  })
})
