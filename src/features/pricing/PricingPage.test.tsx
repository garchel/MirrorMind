import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { PricingPage } from './PricingPage'
import type {
  CheckoutKind,
  CloudStatus,
  CloudTarget,
} from '../../lib/cloudSync'

const CONFIG = { url: 'https://projeto.supabase.co', apiKey: 'chave' }

function status(over: Partial<CloudStatus> = {}): CloudStatus {
  return {
    signedIn: true,
    linked: false,
    vaultName: 'Estudo',
    localFiles: 0,
    remoteFiles: null,
    accountVaults: [],
    needsChoice: false,
    lastSyncedAt: null,
    cloudPlan: 'nenhum',
    planStatus: 'active',
    planPeriodEnd: null,
    ...over,
  }
}

type Deps = {
  readCloudStatus: Mock<(t: CloudTarget) => Promise<CloudStatus>>
  startCheckout: Mock<(kind: CheckoutKind, t: CloudTarget) => Promise<void>>
}

function deps(estado: CloudStatus): Deps {
  return {
    readCloudStatus: vi.fn<(t: CloudTarget) => Promise<CloudStatus>>(async () => estado),
    startCheckout: vi.fn<(kind: CheckoutKind, t: CloudTarget) => Promise<void>>(
      async () => undefined,
    ),
  }
}

function renderPage(
  estado: CloudStatus,
  extras: { onOpenAccount?: () => void; onBack?: () => void } = {},
) {
  const d = deps(estado)
  render(
    <PricingPage vaultPath="C:/vault" config={CONFIG} deps={d} {...extras} />,
  )
  return d
}

afterEach(cleanup)

describe('página de planos', () => {
  it('mostra os quatro planos e o plano atual', async () => {
    renderPage(status())

    expect(await screen.findByRole('heading', { name: /faça upgrade do seu plano/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Grátis' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Nuvem' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Nuvem anual' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'IA gerenciada' })).toBeTruthy()
    expect(screen.getByText(/seu plano hoje/i)).toBeTruthy()
  })

  it('o botão de comprar do anual pede o checkout anual', async () => {
    const d = renderPage(status())
    const botoes = await screen.findAllByRole('button', { name: /comprar agora/i })
    // ordem dos cartões: mensal antes do anual
    await userEvent.click(botoes[1])

    await waitFor(() => expect(d.startCheckout).toHaveBeenCalledTimes(1))
    expect(d.startCheckout.mock.calls[0][0]).toBe('cloud_year')
  })

  it('convidado é levado a entrar, sem chamar o checkout', async () => {
    const onOpenAccount = vi.fn()
    const d = renderPage(status({ signedIn: false }), { onOpenAccount })

    const entrar = await screen.findAllByRole('button', { name: /entrar para assinar/i })
    await userEvent.click(entrar[0])

    expect(onOpenAccount).toHaveBeenCalledTimes(1)
    expect(d.startCheckout).not.toHaveBeenCalled()
  })

  it('com add-on ativo, mostra a validade e não vende de novo', async () => {
    renderPage(
      status({
        cloudPlan: 'nuvem',
        planStatus: 'active',
        planPeriodEnd: '2026-12-19T12:00:00Z',
      }),
    )

    expect(await screen.findByText(/válido até 19\/12\/2026/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /comprar agora/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /nuvem já ativa/i })).toHaveLength(2)
  })

  it('o plano de IA não finge estar à venda', async () => {
    renderPage(status())
    const emBreve = await screen.findByRole('button', { name: /em breve/i })
    expect(emBreve).toHaveProperty('disabled', true)
  })

  it('falha do checkout vira mensagem e o botão não fica travado', async () => {
    const d = deps(status())
    d.startCheckout.mockRejectedValue('O checkout ainda não está configurado neste ambiente.')
    render(<PricingPage vaultPath="C:/vault" config={CONFIG} deps={d} />)

    const botoes = await screen.findAllByRole('button', { name: /comprar agora/i })
    await userEvent.click(botoes[0])

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'O checkout ainda não está configurado neste ambiente.',
    )
    expect(botoes[0]).toHaveProperty('disabled', false)
  })

  it('a página avisa onde o pagamento acontece e oferece voltar', async () => {
    const onBack = vi.fn()
    renderPage(status(), { onBack })

    expect(screen.getByText(/pagamento pelo stripe, no seu navegador/i)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /voltar para as notas/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
