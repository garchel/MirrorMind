import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewNotificationSettings } from './ReviewNotificationSettings'
import type { ReviewNotificationCheck } from './reviewNotifications'

const { getSettingsMock, setSettingsMock, sendTestMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  setSettingsMock: vi.fn(),
  sendTestMock: vi.fn(),
}))

vi.mock('./reviewNotifications', async (importOriginal) => ({
  ...await importOriginal<typeof import('./reviewNotifications')>(),
  getReviewNotificationSettings: getSettingsMock,
  setReviewNotificationSettings: setSettingsMock,
  sendReviewTestNotification: sendTestMock,
}))

function renderSettings(lastCheck: ReviewNotificationCheck | null = null, onRequestCheck = vi.fn()) {
  return {
    onRequestCheck,
    ...render(<ReviewNotificationSettings lastCheck={lastCheck} onRequestCheck={onRequestCheck} />),
  }
}

describe('ReviewNotificationSettings', () => {
  beforeEach(() => {
    getSettingsMock.mockReset()
    setSettingsMock.mockReset()
    sendTestMock.mockReset()
    getSettingsMock.mockResolvedValue({ enabled: false, hour: 9, minute: 0, muted: false })
    setSettingsMock.mockImplementation(async (settings: unknown) => settings)
    sendTestMock.mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('loads the current settings and shows the disabled state', async () => {
    renderSettings()
    expect(await screen.findByLabelText('Resumo diario de revisoes vencidas')).not.toBeChecked()
    expect(screen.queryByLabelText('Hora do resumo diario')).not.toBeInTheDocument()
  })

  it('reveals the time picker, mute toggle and test button once enabled', async () => {
    const user = userEvent.setup()
    renderSettings()
    const toggle = await screen.findByLabelText('Resumo diario de revisoes vencidas')
    await user.click(toggle)
    expect(setSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    expect(await screen.findByLabelText('Hora do resumo diario')).toBeInTheDocument()
    expect(screen.getByLabelText('Silenciar notificacoes de revisao')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar notificacao de teste' })).toBeInTheDocument()
  })

  it('persists a new hour from the time input', async () => {
    const user = userEvent.setup()
    renderSettings()
    const toggle = await screen.findByLabelText('Resumo diario de revisoes vencidas')
    await user.click(toggle)
    const time = await screen.findByLabelText('Hora do resumo diario')
    expect(time).toHaveValue('09:00')
    fireEvent.change(time, { target: { value: '18:45' } })
    expect(setSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ hour: 18, minute: 45 }))
  })

  it('persists the mute state', async () => {
    const user = userEvent.setup()
    renderSettings()
    const toggle = await screen.findByLabelText('Resumo diario de revisoes vencidas')
    await user.click(toggle)
    await user.click(await screen.findByLabelText('Silenciar notificacoes de revisao'))
    expect(setSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true }))
  })

  it('disables the test button while muted and shows a success status after sending', async () => {
    const user = userEvent.setup()
    renderSettings()
    const toggle = await screen.findByLabelText('Resumo diario de revisoes vencidas')
    await user.click(toggle)
    await user.click(await screen.findByLabelText('Silenciar notificacoes de revisao'))
    expect(screen.getByRole('button', { name: 'Enviar notificacao de teste' })).toBeDisabled()
    await user.click(await screen.findByLabelText('Silenciar notificacoes de revisao'))
    await user.click(screen.getByRole('button', { name: 'Enviar notificacao de teste' }))
    expect(sendTestMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Notificacao de teste enviada.')).toBeInTheDocument()
  })

  it('shows the last check status with the due count', async () => {
    renderSettings({
      sent: false,
      dueCount: 3,
      skippedReason: 'Ainda nao e a hora configurada.',
    } as ReviewNotificationCheck)
    expect(await screen.findByLabelText('Resumo diario de revisoes vencidas')).toBeInTheDocument()
    expect(screen.getByText(/Ultima checagem: 3 revisoes vencidas/)).toBeInTheDocument()
    expect(screen.getByText(/Ainda nao e a hora configurada/)).toBeInTheDocument()
  })

  it('requests an immediate check when the daily summary is toggled on', async () => {
    const user = userEvent.setup()
    const onRequestCheck = vi.fn()
    renderSettings(null, onRequestCheck)
    await user.click(await screen.findByLabelText('Resumo diario de revisoes vencidas'))
    expect(onRequestCheck).toHaveBeenCalledTimes(1)
  })

  it('surfaces a loading failure', async () => {
    getSettingsMock.mockRejectedValueOnce(new Error('offline'))
    renderSettings()
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
  })
})
