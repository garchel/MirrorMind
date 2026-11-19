import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudIndicator } from './CloudIndicator'

afterEach(cleanup)

describe('indicador da nuvem', () => {
  it('vault não ligado: não ocupa espaço nenhum', () => {
    const { container } = render(
      <CloudIndicator state="off" lastSyncedAt={null} onOpen={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('ciclo concluído mostra a hora da última sincronização', () => {
    render(
      <CloudIndicator state="synced" lastSyncedAt="2026-11-19T17:30:00Z" onOpen={() => {}} />,
    )
    const botao = screen.getByRole('button')
    expect(botao.textContent).toMatch(/Sincronizado/)
    expect(botao.textContent).toMatch(/\d{2}\/\d{2}/)
  })

  it('nunca sincronizado diz "nunca" em vez de uma data falsa', () => {
    render(<CloudIndicator state="synced" lastSyncedAt={null} onOpen={() => {}} />)
    expect(screen.getByRole('button').textContent).toMatch(/nunca/)
  })

  it('ciclo em andamento tem rótulo e descrição próprios', () => {
    render(<CloudIndicator state="syncing" lastSyncedAt={null} onOpen={() => {}} />)
    const botao = screen.getByRole('button')
    expect(botao.textContent).toMatch(/Sincronizando/)
    expect(botao.getAttribute('aria-label')).toMatch(/Enviando e recebendo/i)
  })

  it('falha aparece sem alarde, e o motivo fica na seção Nuvem', () => {
    render(
      <CloudIndicator state="error" lastSyncedAt="2026-11-19T17:30:00Z" onOpen={() => {}} />,
    )
    const botao = screen.getByRole('button')
    expect(botao.textContent).toMatch(/Sem sincronizar/)
    expect(botao.getAttribute('aria-label')).toMatch(/ver o motivo/i)
  })

  it('clicar leva para a seção Nuvem', async () => {
    const onOpen = vi.fn()
    render(<CloudIndicator state="synced" lastSyncedAt={null} onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
