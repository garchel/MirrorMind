import { useMemo, useState } from 'react'
import { RotateCcw, Search, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { InfoTip } from '../../components/ui/InfoTip'
import type { TrashItem } from '../../lib/useTrashItems'
import './trash.css'

/** Dias que um item fica na lixeira antes da exclusão definitiva (o backend
 *  usa o mesmo prazo; aqui é só para mostrar quanto falta). */
const RETENTION_DAYS = 30
/** A partir daqui o item entra em alerta: perto de ser apagado. */
const WARN_DAYS = 7

function formatTrashDate(day: number) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(day * 86_400_000))
}

function diasRestantes(deletedAtDay: number, hojeEmDias: number) {
  return RETENTION_DAYS - (hojeEmDias - deletedAtDay)
}

function expiracaoTexto(restantes: number): string {
  if (restantes <= 0) return 'expira hoje'
  if (restantes === 1) return '1 dia'
  return `${restantes} dias`
}

type Props = {
  trashItems: TrashItem[]
  loading: boolean
  restoreTrashItem: (id: string) => void
  setPermanentDeleteTarget: (item: TrashItem | null) => void
}

/**
 * Lixeira: a página dizia só "Arquivos excluídos" e uma tabela sem busca, sem
 * ordenação e sem dizer QUANDO cada item desaparece — embora o prazo de 30
 * dias estivesse escrito no texto. Agora o prazo é uma coluna, o item perto de
 * expirar se destaca, e dá para buscar, ordenar e restaurar vários de uma vez.
 */
export function TrashPage({
  trashItems,
  loading,
  restoreTrashItem,
  setPermanentDeleteTarget,
}: Props) {
  const [filtro, setFiltro] = useState('')
  const [ordem, setOrdem] = useState<'recentes' | 'nome'>('recentes')
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set())

  const hojeEmDias = Math.floor(Date.now() / 86_400_000)

  const itens = useMemo(() => {
    const termo = filtro.trim().toLowerCase()
    const filtrados = termo
      ? trashItems.filter((item) => item.originalRelativePath.toLowerCase().includes(termo))
      : trashItems
    const ordenados = [...filtrados]
    ordenados.sort((a, b) => (ordem === 'nome'
      ? a.originalRelativePath.localeCompare(b.originalRelativePath, 'pt-BR')
      : b.deletedAtDay - a.deletedAtDay))
    return ordenados
  }, [trashItems, filtro, ordem])

  const expirando = trashItems.filter(
    (item) => diasRestantes(item.deletedAtDay, hojeEmDias) <= WARN_DAYS,
  ).length
  const todosSelecionados = itens.length > 0 && itens.every((item) => selecionados.has(item.id))

  function alternar(id: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  }

  function alternarTodos() {
    setSelecionados(() => {
      if (todosSelecionados) return new Set<string>()
      return new Set(itens.map((item) => item.id))
    })
  }

  function restaurarSelecionados() {
    const ids = [...selecionados]
    setSelecionados(new Set<string>())
    for (const id of ids) void restoreTrashItem(id)
  }

  return (
    <section className="workspace-page trash-page" aria-labelledby="trash-title" data-builder-name="trash-page">
      <PageHeader
        kicker="Lixeira"
        title="Arquivos excluídos"
        titleId="trash-title"
        description="Itens removidos ficam aqui por 30 dias antes da exclusão definitiva. Restaurar devolve o arquivo ao caminho original."
      >
        <InfoTip label="Histórico de desfazer">
          <p>
            Além da lixeira, as últimas 100 ações ficam no histórico de desfazer, dentro da
            pasta <em>.mirmind</em> do vault — é o que permite recuperar algo que passou do prazo
            da lixeira.
          </p>
        </InfoTip>
      </PageHeader>

      <div className="trash-toolbar">
        <label className="trash-search">
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <Field
            size="sm"
            type="search"
            aria-label="Buscar na lixeira"
            placeholder="Buscar por nome ou caminho…"
            value={filtro}
            onChange={(event) => setFiltro(event.target.value)}
          />
        </label>

        <div className="trash-toolbar-right">
          <span className="trash-count">
            {trashItems.length === 0
              ? 'nenhum item'
              : `${trashItems.length} ${trashItems.length === 1 ? 'item' : 'itens'}`}
            {expirando > 0 ? (
              <> · <strong>{expirando}</strong> {expirando === 1 ? 'expira' : 'expiram'} em até {WARN_DAYS} dias</>
            ) : null}
          </span>
          <label className="trash-order">
            <span>Ordenar</span>
            <select
              value={ordem}
              onChange={(event) => setOrdem(event.target.value === 'nome' ? 'nome' : 'recentes')}
            >
              <option value="recentes">Mais recentes</option>
              <option value="nome">Nome (A–Z)</option>
            </select>
          </label>
        </div>
      </div>

      {selecionados.size > 0 ? (
        <div className="trash-bulk" role="status">
          <span>
            {selecionados.size} {selecionados.size === 1 ? 'selecionado' : 'selecionados'}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={restaurarSelecionados} disabled={loading}>
            <RotateCcw size={14} strokeWidth={1.6} aria-hidden="true" />
            Restaurar selecionados
          </Button>
          <Button type="button" variant="bare" size="sm" onClick={() => setSelecionados(new Set<string>())}>
            Limpar seleção
          </Button>
        </div>
      ) : null}

      <div className="trash-table-wrap" data-builder-name="trash-files">
        <table>
          <thead>
            <tr>
              <th scope="col" className="trash-col-check">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos os itens"
                  checked={todosSelecionados}
                  disabled={itens.length === 0}
                  onChange={alternarTodos}
                />
              </th>
              <th scope="col">Arquivo</th>
              <th scope="col">Tipo</th>
              <th scope="col">Excluído em</th>
              <th scope="col">Expira em</th>
              <th scope="col" className="trash-col-actions">Ações</th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 ? (
              <tr>
                <td colSpan={6} className="trash-empty">
                  {trashItems.length === 0
                    ? 'A lixeira está vazia. Notas e pastas excluídas aparecem aqui por 30 dias.'
                    : `Nenhum item corresponde a “${filtro.trim()}”.`}
                </td>
              </tr>
            ) : itens.map((item) => {
              const restantes = diasRestantes(item.deletedAtDay, hojeEmDias)
              const critico = restantes <= WARN_DAYS
              return (
                <tr key={item.id}>
                  <td className="trash-col-check">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${item.originalRelativePath}`}
                      checked={selecionados.has(item.id)}
                      onChange={() => alternar(item.id)}
                    />
                  </td>
                  <td title={item.originalRelativePath}>
                    {item.originalRelativePath.replace(/\.md$/i, '')}
                  </td>
                  <td>{item.itemType === 'folder' ? 'Pasta' : 'Nota'}</td>
                  <td>{formatTrashDate(item.deletedAtDay)}</td>
                  <td>
                    <span className={`trash-expiry${critico ? ' is-critical' : ''}`}>
                      {expiracaoTexto(restantes)}
                    </span>
                  </td>
                  <td>
                    <div className="trash-table-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void restoreTrashItem(item.id)}
                        disabled={loading}
                        title="Restaurar item"
                        aria-label={`Restaurar ${item.originalRelativePath}`}
                      >
                        <RotateCcw size={14} strokeWidth={1.5} aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setPermanentDeleteTarget(item)}
                        disabled={loading}
                        title="Excluir permanentemente"
                        aria-label={`Excluir permanentemente ${item.originalRelativePath}`}
                      >
                        <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
