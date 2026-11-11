import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRail } from './WorkspaceChrome'

vi.mock('../../components/TitleBar', () => ({
  TitleBarBrand: () => null,
}))

vi.mock('./ProfileFooter', () => ({
  ProfileFooter: () => null,
}))

function renderRail(dueReviewCount: number | null) {
  render(
    <WorkspaceRail
      isSidebarExpanded
      setSidebarExpanded={() => {}}
      workspacePage="notes"
      setWorkspacePage={() => {}}
      openTagManagementPage={() => {}}
      openGraphPage={() => {}}
      openTrashPage={() => {}}
      accountClient={null}
      dueReviewCount={dueReviewCount}
    />,
  )
}

describe('WorkspaceRail — badge de revisão', () => {
  afterEach(cleanup)

  it('mostra a quantidade de notas vencidas no item Revisar', () => {
    renderRail(3)

    const reviewButton = screen.getByRole('button', { name: 'Abrir fila de revisão (3 notas vencidas)' })
    expect(within(reviewButton).getByText('3')).toBeInTheDocument()
  })

  it('usa singular quando há uma nota vencida', () => {
    renderRail(1)

    expect(screen.getByRole('button', { name: 'Abrir fila de revisão (1 nota vencida)' })).toBeInTheDocument()
  })

  it('compacta contagens altas em 99+', () => {
    renderRail(120)

    const reviewButton = screen.getByRole('button', { name: 'Abrir fila de revisão (120 notas vencidas)' })
    expect(within(reviewButton).getByText('99+')).toBeInTheDocument()
  })

  it('não mostra badge sem notas vencidas ou sem medição', () => {
    renderRail(0)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    cleanup()

    renderRail(null)
    expect(screen.queryByText('99+')).not.toBeInTheDocument()
  })
})
