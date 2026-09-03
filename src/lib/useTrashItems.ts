import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

/** Item da lixeira; morava no `App.tsx` (só ele usava). */
export type TrashItem = {
  id: string
  originalRelativePath: string
  trashedName: string
  itemType: 'note' | 'folder'
  deletedAtDay: number
}

/** Operações puras da lixeira (listar, restaurar, excluir permanente).
 *
 * Extraído do `App.tsx` com semântica idêntica — mesmos comandos, mesmas
 * mensagens, mesma ordem (alvo limpo só no sucesso da exclusão
 * permanente). O App injeta as dependências de UI (status/erro/loading,
 * navegação, refresh); o hook é dono dos itens + do alvo permanente.
 *
 * Fora do escopo de propósito: `deleteTarget`/`deleteVaultItem` ficam no
 * App — o soft-delete toca abas, rascunhos, nota ativa e índice wikilink,
 * ou seja, o núcleo do editor; extraí-lo seria indireção sem ganho.
 */
export function useTrashItems(deps: {
  vaultPath: string | null
  refreshNotes: (vaultPath: string, preferredPath?: string) => Promise<unknown>
  goToTrashPage: () => void
  reportStatus: (message: string) => void
  reportError: (message: string | null) => void
  setBusy: (busy: boolean) => void
}) {
  const { vaultPath, refreshNotes, goToTrashPage, reportStatus, reportError, setBusy } = deps
  const [trashItems, setTrashItems] = useState<TrashItem[]>([])
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<TrashItem | null>(null)

  async function openTrashPage(): Promise<void> {
    if (!vaultPath) return
    setBusy(true)
    try {
      const items = await invoke<TrashItem[]>('list_trash', { path: vaultPath })
      setTrashItems(items)
      goToTrashPage()
    } catch (caughtError) {
      reportError(caughtError instanceof Error ? caughtError.message : 'Não foi possível abrir a lixeira.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreTrashItem(id: string): Promise<void> {
    if (!vaultPath) return
    reportError(null)
    setBusy(true)
    try {
      await invoke('restore_trash_item', { path: vaultPath, id })
      setTrashItems((items) => items.filter((item) => item.id !== id))
      reportStatus('Item restaurado no local original.')
      await refreshNotes(vaultPath)
    } catch (caughtError) {
      reportError(caughtError instanceof Error ? caughtError.message : 'Não foi possível restaurar o item.')
    } finally {
      setBusy(false)
    }
  }

  async function permanentlyDeleteTrashItem(): Promise<void> {
    if (!vaultPath || !permanentDeleteTarget) return
    const target = permanentDeleteTarget
    reportError(null)
    setBusy(true)
    try {
      await invoke('permanently_delete_trash_item', { path: vaultPath, id: target.id })
      setTrashItems((items) => items.filter((item) => item.id !== target.id))
      setPermanentDeleteTarget(null)
      reportStatus('Item excluído permanentemente da lixeira.')
    } catch (caughtError) {
      reportError(caughtError instanceof Error ? caughtError.message : 'Não foi possível excluir o item permanentemente.')
    } finally {
      setBusy(false)
    }
  }

  return {
    trashItems,
    permanentDeleteTarget,
    setPermanentDeleteTarget,
    openTrashPage,
    restoreTrashItem,
    permanentlyDeleteTrashItem,
  }
}
