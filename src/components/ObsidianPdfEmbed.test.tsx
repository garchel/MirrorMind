import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ObsidianPdfEmbed } from './ObsidianPdfEmbed'

const pdfState = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  invoke: vi.fn(),
  loadingTaskDestroy: vi.fn(),
  renderCancel: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: pdfState.invoke }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdfState.getDocument,
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.js' }))

describe('ObsidianPdfEmbed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pdfState.invoke.mockResolvedValue(new Uint8Array([37, 80, 68, 70]).buffer)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    pdfState.getPage.mockImplementation(async (pageNumber: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ height: 900 * scale, width: 600 * scale }),
      render: () => ({ cancel: pdfState.renderCancel, promise: Promise.resolve() }),
      pageNumber,
    }))
    pdfState.getDocument.mockReturnValue({
      destroy: pdfState.loadingTaskDestroy,
      promise: Promise.resolve({ getPage: pdfState.getPage, numPages: 2 }),
    })
  })

  it('renders the first page and navigates through the document', async () => {
    render(<ObsidianPdfEmbed relativePath="material.pdf" title="Material de apoio" vaultPath={'C:\\Vault'} />)

    expect(screen.getByRole('status')).toHaveTextContent('Carregando PDF')
    expect(await screen.findByText('Pagina 1 de 2')).toBeInTheDocument()
    expect(pdfState.invoke).toHaveBeenCalledWith('read_pdf_attachment', { path: 'C:\\Vault', relativePath: 'material.pdf' })
    await waitFor(() => expect(pdfState.getPage).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Proxima pagina' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: 'Proxima pagina' }))

    expect(await screen.findByText('Pagina 2 de 2')).toBeInTheDocument()
    await waitFor(() => expect(pdfState.getPage).toHaveBeenCalledWith(2))
    expect(screen.getByRole('button', { name: 'Proxima pagina' })).toBeDisabled()
  })

  it('shows an accessible error without exposing the source URL', async () => {
    pdfState.getDocument.mockReturnValue({
      destroy: pdfState.loadingTaskDestroy,
      promise: Promise.reject(new Error('asset://vault/segredo.pdf indisponivel')),
    })

    render(<ObsidianPdfEmbed relativePath="segredo.pdf" title="Documento" vaultPath={'C:\\Vault'} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Nao foi possivel exibir este PDF.')
    expect(alert).not.toHaveTextContent('asset://')
  })

  it('destroys a loading task created after the component unmounts', async () => {
    const { unmount } = render(<ObsidianPdfEmbed relativePath="material.pdf" title="Material" vaultPath={'C:\\Vault'} />)

    unmount()

    await waitFor(() => expect(pdfState.loadingTaskDestroy).toHaveBeenCalled())
  })

  it('caps the canvas dimensions for PDFs with an extreme page size', async () => {
    pdfState.getPage.mockResolvedValue({
      getViewport: ({ scale }: { scale: number }) => ({ height: 1_000_000 * scale, width: 10_000 * scale }),
      render: () => ({ cancel: pdfState.renderCancel, promise: Promise.resolve() }),
    })

    render(<ObsidianPdfEmbed relativePath="poster.pdf" title="Poster" vaultPath={'C:\\Vault'} />)

    await screen.findByText('Pagina 1 de 2')
    const canvas = screen.getByRole('img', { name: 'Poster, pagina 1' }) as HTMLCanvasElement
    await waitFor(() => expect(canvas.height).toBeGreaterThan(0))
    expect(canvas.height).toBeLessThanOrEqual(8_192)
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000)
  })
})
