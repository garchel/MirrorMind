import { AlertTriangle, FileJson2, Shapes } from 'lucide-react'
import { summarizeSpecialFile } from '../lib/specialFileView'
import type { SpecialVaultFile } from '../lib/vault'
import './special-file-viewer.css'
import { Button } from './ui/Button'

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
          <span>Visualização somente leitura — o arquivo não é alterado.</span>
          <Button autoFocus type="button" className="ui-button modal-close-button" onClick={onClose} aria-label="Fechar visualização do arquivo especial"><span aria-hidden="true">×</span></Button>
        </div>
        {summary === null ? (
          <p className="special-file-viewer-unknown" role="status">Não há visualização estruturada para este tipo de arquivo.</p>
        ) : summary.raw !== null ? (
          <>
            <p className="special-file-viewer-note" role="status">
              <AlertTriangle size={13} strokeWidth={1.75} aria-hidden="true" />
              Não foi possível interpretar este arquivo; exibindo o conteúdo original.
            </p>
            <pre className="special-file-viewer-raw"><code>{summary.raw}</code></pre>
          </>
        ) : (
          <>
            <div className="special-file-viewer-metrics" role="list" aria-label="Resumo do arquivo">
              <div className="special-file-viewer-metric" role="listitem">
                <Shapes size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>{summary.itemCount} {summary.kind === 'canvas' ? 'nós' : 'elementos'}</span>
              </div>
              {summary.types.map((entry) => (
                <span key={entry.type} className="special-file-viewer-type">
                  {entry.type} <small>×{entry.count}</small>
                </span>
              ))}
            </div>
            {summary.canvasNodes.length > 0 ? (
              <ul className="special-file-viewer-nodes" aria-label="Textos do arquivo">
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
              Para editar, abra o arquivo em um aplicativo compatível. O MirrorMind preserva o arquivo original sem alterações.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
