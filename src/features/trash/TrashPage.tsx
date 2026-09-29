import { RotateCcw, Trash2 } from 'lucide-react'
import type { TrashItem } from '../../lib/useTrashItems'

import { Button } from '../../components/ui/Button'
/** Formata o dia da exclusão (movido do `App.tsx` — uso exclusivo da página). */
function formatTrashDate(day: number) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(day * 86_400_000))
}

/** Página da Lixeira extraída do `App.tsx`: mesmos textos e comportamentos.
 * O App continua dono dos itens (useTrashItems) e do estado de loading. */
export function TrashPage({
  trashItems,
  loading,
  restoreTrashItem,
  setPermanentDeleteTarget,
}: {
  trashItems: TrashItem[]
  loading: boolean
  restoreTrashItem: (id: string) => void
  setPermanentDeleteTarget: (item: TrashItem | null) => void
}) {
  return (
    <section className="workspace-page trash-page" data-builder-name="trash-page">
      <p className="card-kicker">Lixeira</p>
      <h2>Arquivos excluídos</h2>
      <p>Arquivos na lixeira sao excluidos permanentemente apos 30 dias. O conteúdo também pode permanecer no histórico de desfazer (até 100 ações) dentro da pasta .mirmind do vault.</p>
      <div className="trash-table-wrap" data-builder-name="trash-files">
        <table>
          <thead>
            <tr><th>Arquivo</th><th>Tipo</th><th>Excluído em</th><th>Ações</th></tr>
          </thead>
          <tbody>
            {trashItems.length === 0 ? <tr><td colSpan={4}>A lixeira está vazia.</td></tr> : trashItems.map((item) => (
              <tr key={item.id}>
                <td title={item.originalRelativePath}>{item.originalRelativePath.replace(/\.md$/i, '')}</td>
                <td>{item.itemType === 'folder' ? 'Pasta' : 'Nota'}</td>
                <td>{formatTrashDate(item.deletedAtDay)}</td>
                <td>
                  <div className="trash-table-actions">
                    <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void restoreTrashItem(item.id)} disabled={loading} title="Restaurar item" aria-label="Restaurar item"><RotateCcw size={14} strokeWidth={1.5} aria-hidden="true" /></Button>
                    <Button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => setPermanentDeleteTarget(item)} disabled={loading} title="Excluir permanentemente" aria-label="Excluir permanentemente"><Trash2 size={14} strokeWidth={1.5} aria-hidden="true" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
