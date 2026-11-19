import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { ANON_SESSION, type SessionClient } from '../../lib/session'

function makeClient(overrides: Partial<SessionClient> = {}): SessionClient {
  return {
    getSession: vi.fn(async () => ({ ...ANON_SESSION })),
    signIn: vi.fn(async (email: string) => ({ status: 'auth' as const, email, expiresAtUnixMs: 1 })),
    signUp: vi.fn(async (email: string) => ({ status: 'auth' as const, email, expiresAtUnixMs: 1 })),
    signInWithGoogle: vi.fn(async () => ({ ...ANON_SESSION })),
    signOut: vi.fn(async () => {}),
    onChange: () => () => {},
    ...overrides,
  }
}

function renderPage(client: SessionClient, handlers: { onAuthenticated?: () => void; onSkip?: () => void } = {}) {
  return render(
    <LoginPage
      client={client}
      onAuthenticated={handlers.onAuthenticated ?? (() => {})}
      onSkip={handlers.onSkip ?? (() => {})}
    />,
  )
}

describe('LoginPage', () => {
  afterEach(cleanup)

  it('abre no modo entrar, com e-mail e senha', async () => {
    renderPage(makeClient())
    expect(await screen.findByRole('heading', { name: 'Entrar no MirrorMind' })).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
  })

  it('não deixa entrar com senha curta ou e-mail sem @', async () => {
    const client = makeClient()
    const user = userEvent.setup()
    renderPage(client)

    const entrar = screen.getByRole('button', { name: 'Entrar' })
    expect(entrar).toBeDisabled()

    await user.type(screen.getByLabelText('E-mail'), 'sem-arroba')
    await user.type(screen.getByLabelText('Senha'), 'segredo')
    expect(entrar).toBeDisabled()

    await user.clear(screen.getByLabelText('E-mail'))
    await user.type(screen.getByLabelText('E-mail'), 'pessoa@exemplo.com')
    expect(entrar).toBeEnabled()
  })

  it('entra e avisa quando a sessão existe', async () => {
    const client = makeClient()
    const onAuthenticated = vi.fn()
    const user = userEvent.setup()
    renderPage(client, { onAuthenticated })

    await user.type(screen.getByLabelText('E-mail'), '  pessoa@exemplo.com  ')
    await user.type(screen.getByLabelText('Senha'), 'segredo1')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => expect(client.signIn).toHaveBeenCalledWith('pessoa@exemplo.com', 'segredo1'))
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled())
  })

  it('mostra o erro do servidor sem quebrar a página', async () => {
    const client = makeClient({
      signIn: vi.fn(async () => {
        throw new Error('E-mail ou senha incorretos.')
      }),
    })
    const user = userEvent.setup()
    renderPage(client)

    await user.type(screen.getByLabelText('E-mail'), 'pessoa@exemplo.com')
    await user.type(screen.getByLabelText('Senha'), 'errada1')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
  })

  it('no modo criar conta pede consentimento e chama signUp', async () => {
    const client = makeClient()
    const user = userEvent.setup()
    renderPage(client)

    await user.click(screen.getByRole('radio', { name: 'Criar conta' }))
    expect(await screen.findByRole('heading', { name: 'Criar sua conta' })).toBeInTheDocument()
    expect(screen.getByText(/aceita os Termos de uso/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText('E-mail'), 'pessoa@exemplo.com')
    await user.type(screen.getByLabelText('Senha'), 'segredo1')
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))

    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith('pessoa@exemplo.com', 'segredo1'))
    expect(client.signIn).not.toHaveBeenCalled()
  })

  it('"continuar sem conta" sai sem chamar o servidor', async () => {
    const client = makeClient()
    const onSkip = vi.fn()
    const user = userEvent.setup()
    renderPage(client, { onSkip })

    await user.click(screen.getByRole('button', { name: 'Continuar sem conta' }))

    expect(onSkip).toHaveBeenCalledTimes(1)
    expect(client.signIn).not.toHaveBeenCalled()
    expect(client.signUp).not.toHaveBeenCalled()
  })

  it('Google abre o fluxo do sistema e não some da tela', async () => {
    const client = makeClient()
    const user = userEvent.setup()
    renderPage(client)

    const google = screen.getByRole('button', { name: 'Continuar com o Google' })
    expect(google).toBeEnabled()

    await user.click(google)
    await waitFor(() => expect(client.signInWithGoogle).toHaveBeenCalledTimes(1))
  })
})
