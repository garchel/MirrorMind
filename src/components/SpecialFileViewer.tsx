import { AlertTriangle, FileJson2, Shapes } from 'lucide-react'
import { summarizeSpecialFile } from '../lib/specialFileView'
import type { SpecialVaultFile } from '../lib/vault'
import './special-file-viewer.css'

type Props = {
  file: SpecialVaultFile
  content: string
  onClose: () => void
}

const KIND_LABELS: Record<SpecialVaultFile['kind'], string> = {
  canvas: 'Canvas',
  excalidraw: 'Excalidraw',
  unknown: 'Arquivo especial',
}

/** Visualizacao SOMENTE LEITURA de Canvas/Excalidraw: resume o JSON em uma
 * visao estruturada (contagens por tipo e nos de texto) e nunca executa nada
 * nem altera o arquivo. JSON invalido exibe a fonte crua preservada. */
export function SpecialFileViewer({ file, content, onClose }: Props) {
  const summary = file.kind === 'canvas' || file.kind === 'excalidraw'
    ? summarizeSpecialFile(file.kind, content)
    : null
  return (
    <div className="note-search-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        className="note-search-modal special-file-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`Visualizar ${file.name}`}
        onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
      >
        <div className="move-item-heading">
          <strong>{KIND_LABELS[file.kind]}: {file.name}</strong>
          <span>Visualização somente leitura — o arquivo não é alterado e o código de plugin nunca é executado.</span>
          <button autoFocus type="button" className="modal-close-button" onClick={onClose} aria-label="Fechar visualização do arquivo especial"><span aria-hidden="true">×</span></button>
        </div>
        {summary === null ? (
          <p className="special-file-viewer-unknown" role="status">Não ha visualização estruturada para este tipo de arquivo.</p>
        ) : summary.raw !== null ? (
          <>
            <p className="special-file-viewer-note" role="status">
              <AlertTriangle size={13} strokeWidth={1.75} aria-hidden="true" />
              O JSON não pode ser interpretado; exibindo o conteudo cru preservado.
            </p>
            <pre className="special-file-viewer-raw"><code>{summary.raw}</code></pre>
          </>
        ) : (
          <>
            <div className="special-file-viewer-metrics" role="list" aria-label="Resumo do arquivo">
              <div className="special-file-viewer-metric" role="listitem">
                <Shapes size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>{summary.itemCount} {summary.kind === 'canvas' ? 'nos' : 'elementos'}</span>
              </div>
              {summary.types.map((entry) => (
                <span key={entry.type} className="special-file-viewer-type">
                  {entry.type} <small>×{entry.count}</small>
                </span>
              ))}
            </div>
            {summary.canvasNodes.length > 0 ? (
              <ul className="special-file-viewer-nodes" aria-label="Nos de texto do Canvas">
                {summary.canvasNodes.map((node) => (
                  <li key={node.id}>
                    <span className="special-file-viewer-node-type">{node.type}</span>
                    <span className="special-file-viewer-node-text">{node.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="special-file-viewer-files-note">
              <FileJson2 size={13} strokeWidth={1.75} aria-hidden="true" />
              Para editar, abra o arquivo no Obsidian: o MirrorMind preserva o `.canvas`/`.excalidraw` sem alterações.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
