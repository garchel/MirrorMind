import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'
import type { AppUpdaterController } from '../lib/useAppUpdater'

function makeUpdater(status: AppUpdaterController['status']): AppUpdaterController {
  return {
    status,
    checkNow: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    dismiss: vi.fn(),
  }
}

afterEach(cleanup)

describe('UpdateBanner', () => {
  it('nao renderiza nada quando idle ou upToDate', () => {
    const { container, unmount } = render(<UpdateBanner updater={makeUpdater({ kind: 'idle' })} />)
    expect(container.querySelector('.update-banner')).toBeNull()
    unmount()
    const { container: second } = render(<UpdateBanner updater={makeUpdater({ kind: 'upToDate' })} />)
    expect(second.querySelector('.update-banner')).toBeNull()
  })

  it('exibe versao nova e botao de instalar quando available', () => {
    render(
      <UpdateBanner
        updater={makeUpdater({ kind: 'available', update: { version: '0.2.0', currentVersion: '0.1.0', notes: '' } })}
      />,
    )
    expect(screen.getByText(/0\.2\.0/)).toBeInTheDocument()
    expect(screen.getByText(/0\.1\.0/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Baixar e instalar' })).toBeInTheDocument()
  })

  it('dispara install ao clicar em Baixar e instalar', async () => {
    const user = userEvent.setup()
    const install = vi.fn(async () => undefined)
    render(
      <UpdateBanner
        updater={{
          status: { kind: 'available', update: { version: '0.2.0', currentVersion: '0.1.0', notes: '' } },
          checkNow: vi.fn(async () => undefined),
          install,
          dismiss: vi.fn(),
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Baixar e instalar' }))
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('mostra progresso durante o download e sem botao de fechar', () => {
    render(<UpdateBanner updater={makeUpdater({ kind: 'downloading', progress: 42 })} />)
    expect(screen.getByText(/Baixando atualização… 42%/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(screen.queryByRole('button', { name: 'Dispensar aviso de atualização' })).toBeNull()
  })

  it('dismiss remove o banner', async () => {
    const user = userEvent.setup()
    const dismiss = vi.fn()
    const { container } = render(
      <UpdateBanner
        updater={{
          status: { kind: 'available', update: { version: '0.2.0', currentVersion: '0.1.0', notes: '' } },
          checkNow: vi.fn(async () => undefined),
          install: vi.fn(async () => undefined),
          dismiss,
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Dispensar aviso de atualização' }))
    expect(dismiss).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.update-banner')).not.toBeNull()
  })
})
