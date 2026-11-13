import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { InfoTip } from './InfoTip'

afterEach(cleanup)

describe('InfoTip', () => {
  it('rotula o gatilho com o nome do bloco, nao com um "?" generico', () => {
    render(
      <InfoTip label="Prontidão para revisar">
        <p>Se a nota pode ser avaliada.</p>
      </InfoTip>,
    )

    expect(screen.getByRole('button', { name: 'Como funciona: Prontidão para revisar' })).toBeInTheDocument()
  })

  it('abre pelo clique (unico caminho em tela de toque)', async () => {
    render(
      <InfoTip label="Datas-limite">
        <p>Data de prova definida numa tag.</p>
      </InfoTip>,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: /Como funciona/ }))

    const balao = await screen.findByRole('tooltip')
    expect(balao).toHaveTextContent('Data de prova definida numa tag.')
  })

  it('abre ao passar o mouse', async () => {
    render(
      <InfoTip label="Notas longas em calibração">
        <p>Avaliada por partes.</p>
      </InfoTip>,
    )

    await userEvent.setup().hover(screen.getByRole('button', { name: /Como funciona/ }))

    // O hover espera 160ms de proposito antes de abrir.
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Avaliada por partes.')
  })

  it('fecha com Escape', async () => {
    const user = userEvent.setup()
    render(
      <InfoTip label="Histórico completo">
        <p>Todas as sessões concluídas.</p>
      </InfoTip>,
    )

    await user.click(screen.getByRole('button', { name: /Como funciona/ }))
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(await screen.findByRole('button', { name: /Como funciona/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('nao repete o mesmo rotulo em blocos diferentes', () => {
    render(
      <>
        <InfoTip label="Minhas notas"><p>a</p></InfoTip>
        <InfoTip label="Minhas tags"><p>b</p></InfoTip>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Como funciona: Minhas notas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Como funciona: Minhas tags' })).toBeInTheDocument()
  })
})
