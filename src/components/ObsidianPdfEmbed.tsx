import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

type ObsidianPdfEmbedProps = {
  relativePath: string
  title: string
  vaultPath: string
}

type PdfState =
  | { kind: 'loading' }
  | { document: PDFDocumentProxy, kind: 'ready' }
  | { kind: 'error' }

const MAX_CANVAS_DIMENSION = 8_192
const MAX_CANVAS_PIXELS = 16_000_000

async function startPdfLoad(vaultPath: string, relativePath: string) {
  const [data, pdfjs, worker] = await Promise.all([
    invoke<ArrayBuffer>('read_pdf_attachment', { path: vaultPath, relativePath }),
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs.getDocument({ data: new Uint8Array(data) })
}

export function ObsidianPdfEmbed({ relativePath, title, vaultPath }: ObsidianPdfEmbedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pdfState, setPdfState] = useState<PdfState>({ kind: 'loading' })
  const [rendering, setRendering] = useState(false)

  useEffect(() => {
    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null

    setPageNumber(1)
    setPdfState({ kind: 'loading' })
    void startPdfLoad(vaultPath, relativePath)
      .then((task) => {
        loadingTask = task
        if (cancelled) {
          void task.destroy()
          return null
        }
        return task.promise
      })
      .then((document) => {
        if (cancelled || !document) return
        setPdfState({ document, kind: 'ready' })
      })
      .catch(() => {
        if (!cancelled) setPdfState({ kind: 'error' })
      })

    return () => {
      cancelled = true
      void loadingTask?.destroy()
    }
  }, [relativePath, vaultPath])

  useEffect(() => {
    if (pdfState.kind !== 'ready' || !canvasRef.current) return
    let cancelled = false
    let renderTask: RenderTask | null = null
    setRendering(true)

    void pdfState.document.getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return
        const canvas = canvasRef.current
        const baseViewport = page.getViewport({ scale: 1 })
        if (baseViewport.width <= 0 || baseViewport.height <= 0) throw new Error('Invalid PDF page size')
        const availableWidth = Math.max(1, Math.min(frameRef.current?.clientWidth || 760, 760) - 32)
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        let viewport = page.getViewport({ scale: availableWidth / baseViewport.width })
        const rawWidth = viewport.width * outputScale
        const rawHeight = viewport.height * outputScale
        const reduction = Math.min(
          1,
          MAX_CANVAS_DIMENSION / rawWidth,
          MAX_CANVAS_DIMENSION / rawHeight,
          Math.sqrt(MAX_CANVAS_PIXELS / (rawWidth * rawHeight)),
        )
        if (reduction < 1) viewport = page.getViewport({ scale: (availableWidth / baseViewport.width) * reduction })

        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        renderTask = page.render({
          canvas,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        })
        return renderTask.promise
      })
      .then(() => {
        if (!cancelled) setRendering(false)
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
          setPdfState({ kind: 'error' })
        }
      })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pageNumber, pdfState])

  function changePage(nextPage: number) {
    setRendering(true)
    setPageNumber(nextPage)
  }

  if (pdfState.kind === 'loading') {
    return <section className="obsidian-pdf-embed is-loading" role="status">Carregando PDF...</section>
  }
  if (pdfState.kind === 'error') {
    return <section className="obsidian-pdf-embed is-error" role="alert">Nao foi possivel exibir este PDF.</section>
  }

  return (
    <section className="obsidian-pdf-embed" aria-label={`PDF incorporado: ${title}`}>
      <header>
        <strong title={title}>{title}</strong>
        <span aria-live="polite">Pagina {pageNumber} de {pdfState.document.numPages}</span>
      </header>
      <div className="obsidian-pdf-canvas-frame" ref={frameRef} aria-busy={rendering}>
        <canvas ref={canvasRef} role="img" aria-label={`${title}, pagina ${pageNumber}`}>Pre-visualizacao da pagina {pageNumber} do PDF {title}.</canvas>
      </div>
      <nav aria-label="Navegacao do PDF">
        <button type="button" onClick={() => changePage(Math.max(1, pageNumber - 1))} disabled={rendering || pageNumber === 1}>Pagina anterior</button>
        <button type="button" onClick={() => changePage(Math.min(pdfState.document.numPages, pageNumber + 1))} disabled={rendering || pageNumber === pdfState.document.numPages}>Proxima pagina</button>
      </nav>
    </section>
  )
}
