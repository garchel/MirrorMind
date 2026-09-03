import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Hash, Pencil, Plus, Search, Settings, Trash2, X } from 'lucide-react'
import {
  getVaultReviewPolicyConfig,
  tagReviewPolicyRuleSchema,
  type TagReviewPolicyRule,
  type VaultReviewPolicyConfig,
} from '../review/vaultReviewPolicy'
import {
  applyTagManagementChange,
  getTagIndex,
  previewTagManagementChange,
  type TagManagementChange,
  type TagManagementPreview,
  type TagSummary,
} from './tagManagement'
import { PolicyWorkloadEstimate } from '../review/PolicyWorkloadEstimate'
import { Modal, ModalHeader } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import './tag-management.css'

type Props = {
  vaultPath: string
  onTagsChanged?: (markdownNotePaths: string[]) => void | Promise<void>
}

type TagEntry = {
  tag: string
  notePaths: string[]
  rule: TagReviewPolicyRule | null
}

type PendingChange = {
  title: string
  description: string
  change: TagManagementChange
  preview: TagManagementPreview
  tagRules: TagReviewPolicyRule[]
}

const PRESETS = {
  intensive: {
    label: 'Intensiva',
    description: 'Para conteúdo de prova e alta prioridade.',
    values: {
      firstReviewIntervalDays: 1,
      targetRetention: 0.9,
      priorityWeight: 3,
      minIntervalDays: 1,
      maxIntervalDays: 90,
    },
  },
  balanced: {
    label: 'Equilibrada',
    description: 'Boa retenção sem concentrar revisões.',
    values: {
      firstReviewIntervalDays: 2,
      targetRetention: 0.8,
      priorityWeight: 2,
      minIntervalDays: 1,
      maxIntervalDays: 365,
    },
  },
  light: {
    label: 'Leve',
    description: 'Para não esquecer completamente.',
    values: {
      firstReviewIntervalDays: 7,
      targetRetention: 0.7,
      priorityWeight: 1,
      minIntervalDays: 3,
      maxIntervalDays: 730,
    },
  },
} as const

function normalizeTagInput(value: string) {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
}

function draftFor(tag: string, rule?: TagReviewPolicyRule | null): TagReviewPolicyRule {
  return rule
    ? { ...rule }
    : {
        tag,
        autoEnroll: false,
        ...PRESETS.balanced.values,
        deadlineAtUnixMs: null,
        preferredMode: null,
      }
}

function deadlineDateValue(deadline: number | null) {
  if (deadline === null) return ''
  const date = new Date(deadline)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function deadlineFromDateInput(value: string): number | null {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

function buildEntries(index: TagSummary[], config: VaultReviewPolicyConfig): TagEntry[] {
  const indexed = new Map(index.map((entry) => [entry.tag, entry.notePaths]))
  const configured = new Map(config.tagRules.map((rule) => [rule.tag, rule]))
  return [...new Set([...indexed.keys(), ...configured.keys()])]
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))
    .map((tag) => ({
      tag,
      notePaths: indexed.get(tag) ?? [],
      rule: configured.get(tag) ?? null,
    }))
}

type TagTreeNode = {
  name: string
  fullPath: string
  depth: number
  children: TagTreeNode[]
  /** Entrada exata desta tag (notas + politica), ou null para pasta intermediaria. */
  entry: TagEntry | null
  /** Notas proprias + notas de todas as tags descendentes. */
  aggregateCount: number
}

/** Monta a arvore aninhada a partir do caminho das tags (ex.: `concurso/matematica`). */
function buildTagTree(entries: TagEntry[]): TagTreeNode[] {
  const root: TagTreeNode[] = []
  const byPath = new Map<string, TagTreeNode>()
  for (const entry of [...entries].sort((left, right) => left.tag.localeCompare(right.tag, 'pt-BR'))) {
    const segments = entry.tag.split('/')
    let path = ''
    let siblings = root
    for (let index = 0; index < segments.length; index++) {
      path = index === 0 ? segments[0] : `${path}/${segments[index]}`
      let node = byPath.get(path)
      if (!node) {
        node = {
          name: segments[index],
          fullPath: path,
          depth: index,
          children: [],
          entry: null,
          aggregateCount: 0,
        }
        byPath.set(path, node)
        siblings.push(node)
      }
      if (index === segments.length - 1) {
        node.entry = entry
        node.aggregateCount = entry.notePaths.length
      }
      siblings = node.children
    }
  }
  const aggregate = (node: TagTreeNode): number => {
    let total = node.aggregateCount
    for (const child of node.children) total += aggregate(child)
    node.aggregateCount = total
    return total
  }
  for (const node of root) aggregate(node)
  return root
}

/** Filtra a arvore mantendo os ancestrais dos resultados (todos forçadamente expandidos). */
function filterTagTree(nodes: TagTreeNode[], query: string): TagTreeNode[] {
  const normalized = normalizeTagInput(query)
  if (!normalized) return nodes
  const matches = (node: TagTreeNode): boolean => (
    node.fullPath.includes(normalized) || node.children.some(matches)
  )
  const keep = (node: TagTreeNode): TagTreeNode | null => {
    if (!matches(node)) return null
    return {
      ...node,
      children: node.children
        .map(keep)
        .filter((child): child is TagTreeNode => child !== null),
    }
  }
  return nodes
    .map(keep)
    .filter((node): node is TagTreeNode => node !== null)
}

/** Caminhos dos ancestrais de uma tag (ex.: `a/b/c` -> [`a`, `a/b`]). */
function ancestorPaths(tag: string): string[] {
  const segments = tag.split('/')
  const paths: string[] = []
  for (let index = 0; index < segments.length - 1; index++) {
    paths.push(segments.slice(0, index + 1).join('/'))
  }
  return paths
}

function findTagNode(nodes: TagTreeNode[], fullPath: string): TagTreeNode | null {
  for (const node of nodes) {
    if (node.fullPath === fullPath) return node
    const found = findTagNode(node.children, fullPath)
    if (found) return found
  }
  return null
}

/** Todas as entradas reais sob um no da arvore (incluindo o proprio, se existir). */
function subtreeEntries(node: TagTreeNode): TagEntry[] {
  const out: TagEntry[] = []
  if (node.entry) out.push(node.entry)
  for (const child of node.children) out.push(...subtreeEntries(child))
  return out
}

type TagTreeBranchProps = {
  nodes: TagTreeNode[]
  selected: string | null
  expanded: Set<string>
  querying: boolean
  onSelect: (node: TagTreeNode) => void
}

function TagTreeBranch({ nodes, selected, expanded, querying, onSelect }: TagTreeBranchProps) {
  return (
    <ul className="tag-tree-list" role="tree">
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isExpanded = querying || expanded.has(node.fullPath)
        const isSelected = node.fullPath === selected
        return (
          <li key={node.fullPath} role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined} aria-selected={isSelected}>
            <button
              type="button"
              className={`tag-tree-row${isSelected ? ' is-selected' : ''}`}
              onClick={() => onSelect(node)}
              title={`#${node.fullPath}`}
              aria-label={`#${node.fullPath} · ${node.aggregateCount} ${node.aggregateCount === 1 ? 'nota' : 'notas'}`}
            >
              {hasChildren ? (
                <ChevronRight size={14} strokeWidth={2} className={`tag-tree-chevron${isExpanded ? ' is-open' : ''}`} aria-hidden="true" />
              ) : (
                <span className="tag-tree-chevron-slot" aria-hidden="true" />
              )}
              <Hash size={13} strokeWidth={1.8} className="tag-tree-hash" aria-hidden="true" />
              <span className="tag-tree-name">{node.name}</span>
              {node.entry?.rule?.autoEnroll ? <i className="tag-tree-dot is-review-on" aria-label="Revisão automática ativa" /> : null}
              <span className="tag-tree-count">{node.aggregateCount}</span>
            </button>
            {hasChildren && isExpanded ? (
              <TagTreeBranch nodes={node.children} selected={selected} expanded={expanded} querying={querying} onSelect={onSelect} />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function TagManagementPage({ vaultPath, onTagsChanged }: Props) {
  const [config, setConfig] = useState<VaultReviewPolicyConfig | null>(null)
  const [tagIndex, setTagIndex] = useState<TagSummary[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view')
  const [draft, setDraft] = useState<TagReviewPolicyRule>(() => draftFor(''))
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingChange | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const generationRef = useRef(0)
  const selectedTagRef = useRef<string | null>(null)
  useEffect(() => {
    selectedTagRef.current = selectedTag
  }, [selectedTag])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setLoading(true)
    setError('')
    setSuccess('')
    void Promise.all([getTagIndex(vaultPath), getVaultReviewPolicyConfig(vaultPath)])
      .then(([nextIndex, nextConfig]) => {
        if (generationRef.current !== generation) return
        setTagIndex(nextIndex)
        setConfig(nextConfig)
        const nextEntries = buildEntries(nextIndex, nextConfig)
        const nextSelected = nextEntries.some((entry) => entry.tag === selectedTagRef.current)
          ? selectedTagRef.current
          : nextEntries[0]?.tag ?? null
        setSelectedTag(nextSelected)
        if (nextSelected) {
          setExpanded((previous) => new Set([...previous, ...ancestorPaths(nextSelected)]))
        }
        setMode('view')
      })
      .catch((cause) => {
        if (generationRef.current === generation) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (generationRef.current === generation) setLoading(false)
      })
  }, [reloadToken, vaultPath])

  const entries = useMemo(
    () => config ? buildEntries(tagIndex, config) : [],
    [config, tagIndex],
  )
  const atRuleLimit = (config?.tagRules.length ?? 0) >= 100
  const selected = entries.find((entry) => entry.tag === selectedTag) ?? null
  const tree = useMemo(() => buildTagTree(entries), [entries])
  const filteredTree = useMemo(() => filterTagTree(tree, query), [tree, query])
  const selectedNode = selectedTag ? findTagNode(tree, selectedTag) : null
  const folderEntries = useMemo(
    () => (selectedNode && !selectedNode.entry ? subtreeEntries(selectedNode) : []),
    [selectedNode],
  )
  const folderNotePaths = useMemo(
    () => [...new Set(folderEntries.flatMap((entry) => entry.notePaths))],
    [folderEntries],
  )
  // Dados da tag que esta sendo excluida, para os avisos do modal.
  const pendingDeleteTag = pendingDelete?.change.currentTag ?? null
  const pendingDeleteNode = pendingDeleteTag ? findTagNode(tree, pendingDeleteTag) : null
  const pendingDeleteEntry = pendingDeleteTag
    ? entries.find((entry) => entry.tag === pendingDeleteTag) ?? null
    : null
  const pendingDeleteNested = pendingDeleteNode?.children.length ?? 0
  const pendingDeleteNotes = pendingDeleteEntry?.notePaths.length ?? 0
  const validation = tagReviewPolicyRuleSchema.safeParse(draft)
  const duplicate = entries.some((entry) => (
    entry.tag === draft.tag && (mode === 'create' || entry.tag !== selectedTag)
  ))

  /** Clique na arvore: mostra os dados da tag clicada e expande/colapsa os aninhados. */
  function handleTreeSelect(node: TagTreeNode) {
    if (busy) return
    setSelectedTag(node.fullPath)
    setMode('view')
    setPending(null)
    setError('')
    setSuccess('')
    if (node.children.length > 0) {
      setExpanded((previous) => {
        const next = new Set(previous)
        if (next.has(node.fullPath)) next.delete(node.fullPath)
        else next.add(node.fullPath)
        return next
      })
    }
  }

  function startCreate(prefillTag = '') {
    if (atRuleLimit) return
    setSelectedTag(null)
    setDraft(draftFor(prefillTag))
    setMode('create')
    setPending(null)
    setError('')
    setSuccess('')
  }

  function startEdit() {
    if (!selected) return
    setDraft(draftFor(selected.tag, selected.rule))
    setMode('edit')
    setPending(null)
    setError('')
    setSuccess('')
  }

  function cancelEditing() {
    setMode('view')
    if (!selectedTag && entries[0]) {
      setSelectedTag(entries[0].tag)
      setExpanded((previous) => new Set([...previous, ...ancestorPaths(entries[0].tag)]))
    }
    setError('')
  }

  function updateDraft(patch: Partial<TagReviewPolicyRule>) {
    setDraft((current) => ({ ...current, ...patch }))
    setError('')
    setSuccess('')
  }

  function applyPreset(values: typeof PRESETS[keyof typeof PRESETS]['values']) {
    updateDraft({ ...values })
  }

  function nextRulesForSave(rule: TagReviewPolicyRule) {
    if (!config) return []
    if (mode === 'create') return [...config.tagRules, rule]
    const withoutCurrent = config.tagRules.filter((item) => item.tag !== selectedTag)
    return [...withoutCurrent, rule]
  }

  async function requestSave() {
    if (!config || !validation.success || duplicate) return
    const rule = validation.data
    const currentTag = mode === 'edit' ? selectedTag : null
    const change: TagManagementChange = {
      currentTag,
      nextTag: rule.tag,
      removeFromNotes: false,
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const preview = await previewTagManagementChange(vaultPath, change)
      setPending({
        title: mode === 'create' ? `Criar #${rule.tag}` : `Salvar alterações em #${selectedTag}`,
        description: currentTag && currentTag !== rule.tag
          ? `A tag será renomeada para #${rule.tag} nas notas abaixo e sua política será recalculada.`
          : 'A política de revisão será recalculada para as notas abaixo.',
        change,
        preview,
        tagRules: nextRulesForSave(rule),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function requestDelete() {
    if (!config || !selected) return
    const change: TagManagementChange = {
      currentTag: selected.tag,
      nextTag: null,
      removeFromNotes: false,
    }
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const preview = await previewTagManagementChange(vaultPath, change)
      setPendingDelete({
        title: `Excluir #${selected.tag}`,
        description: 'A configuração da tag será excluída. Escolha se ela também deve ser removida do Markdown das notas.',
        change,
        preview,
        tagRules: config.tagRules.filter((rule) => rule.tag !== selected.tag),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function applyPendingChange(pendingChange: PendingChange) {
    if (!config || !pendingChange) return
    const generation = generationRef.current
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const result = await applyTagManagementChange({
        vaultPath,
        expectedRevision: config.revision,
        tagRules: pendingChange.tagRules,
        change: pendingChange.change,
        expectedAffectedNotePaths: pendingChange.preview.affectedNotePaths,
      })
      if (generationRef.current !== generation) return
      const nextIndex = await getTagIndex(vaultPath)
      if (generationRef.current !== generation) return
      setConfig(result.config)
      setTagIndex(nextIndex)
      const nextSelected = pendingChange.change.nextTag
      setSelectedTag(nextSelected)
      if (nextSelected) {
        setExpanded((previous) => new Set([...previous, ...ancestorPaths(nextSelected)]))
      }
      setMode('view')
      setPending(null)
      setPendingDelete(null)
      setSuccess(
        `${pendingChange.preview.affectedNotePaths.length} nota(s) atualizada(s).`
        + (result.markdownNotePaths.length > 0
          ? ` A tag foi alterada no Markdown de ${result.markdownNotePaths.length} nota(s).`
          : ''),
      )
      await onTagsChanged?.(result.markdownNotePaths)
    } catch (cause) {
      setPending(null)
      setPendingDelete(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generationRef.current === generation) setBusy(false)
    }
  }

  function confirmPending() {
    if (pending) void applyPendingChange(pending)
  }

  function confirmDelete() {
    if (pendingDelete) void applyPendingChange(pendingDelete)
  }

  const form = mode === 'create' || mode === 'edit'

  return (
    <section className="workspace-page tag-management-page" aria-labelledby="tag-management-title">
      <PageHeader
        kicker="Organização"
        title="Tags do vault"
        titleId="tag-management-title"
        description="Gerencie a classificação das notas e a política de revisão que cada tag transmite."
      >
        <div className="tag-header-actions">
          {atRuleLimit ? (
            <p className="tag-limit-note" role="status">Limite de 100 regras atingido — edite ou exclua uma antes de criar outra.</p>
          ) : null}
          <button
            type="button"
            onClick={() => startCreate()}
            disabled={busy || loading || atRuleLimit}
            title={atRuleLimit ? 'Limite de 100 regras de tag atingido' : undefined}
          >
            <Plus size={16} aria-hidden="true" />
            Criar tag
          </button>
        </div>
      </PageHeader>

      <div className="tag-management-layout">
        <aside className="tag-tree-pane" aria-label="Tags existentes">
          <label className="tag-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Buscar tags</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar tag"
            />
          </label>
          <div className="tag-tree-summary">
            <span>{entries.length} tag{entries.length === 1 ? '' : 's'}</span>
            <span>{entries.filter((entry) => entry.rule?.autoEnroll).length} ativam revisão</span>
          </div>
          {loading ? <p className="tag-page-state" role="status">Carregando tags…</p> : null}
          {!loading && filteredTree.length === 0 ? (
            <div className="tag-empty-state">
              <Hash size={22} aria-hidden="true" />
              <strong>{entries.length === 0 ? 'Nenhuma tag ainda' : 'Nenhum resultado'}</strong>
              <p>{entries.length === 0 ? 'Crie a primeira tag para organizar o vault.' : 'Tente outro termo de busca.'}</p>
            </div>
          ) : null}
          {!loading && filteredTree.length > 0 ? (
            <div className="tag-tree-scroll">
              <TagTreeBranch
                nodes={filteredTree}
                selected={selectedTag}
                expanded={expanded}
                querying={query.trim() !== ''}
                onSelect={handleTreeSelect}
              />
            </div>
          ) : null}
        </aside>

        <main className="tag-detail">
          {form ? (
            <>
              <div className="tag-detail-heading">
                <div>
                  <p className="card-kicker">{mode === 'create' ? 'Nova tag' : 'Editando tag'}</p>
                  <h3>{mode === 'create' ? 'Defina a tag e seu ritmo' : `#${selectedTag}`}</h3>
                </div>
                <button type="button" className="secondary-button tag-icon-button" onClick={cancelEditing} disabled={busy} aria-label="Cancelar edição">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="tag-form">
                <label className="tag-name-field">
                  <span>Nome da tag</span>
                  <div><Hash size={16} aria-hidden="true" /><input autoFocus aria-label="Nome da tag" value={draft.tag} onChange={(event) => updateDraft({ tag: normalizeTagInput(event.target.value) })} placeholder="materia/biologia" /></div>
                  <small>Use letras, números, hífen, sublinhado e / para criar hierarquia.</small>
                </label>

                <label className="tag-review-switch">
                  <span>
                    <strong>Habilitar revisão automaticamente</strong>
                    <small>Notas prontas com esta tag entram no aprendizado sem ativação manual.</small>
                  </span>
                  <input type="checkbox" checked={draft.autoEnroll} onChange={(event) => updateDraft({ autoEnroll: event.target.checked })} />
                </label>

                <fieldset className="tag-presets">
                  <legend>Perfil de revisão</legend>
                  <div>
                    {Object.values(PRESETS).map((preset) => (
                      <button type="button" className="secondary-button" key={preset.label} onClick={() => applyPreset(preset.values)}>
                        <strong>{preset.label}</strong>
                        <small>{preset.description}</small>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="tag-mode-field">
                  <legend>Modo de revisão herdado</legend>
                  <div className="tag-mode-options">
                    <label>
                      <input type="radio" name="tag-preferred-mode" checked={draft.preferredMode === null} onChange={() => updateDraft({ preferredMode: null })} />
                      <span><strong>Sem preferência</strong><small>A nota usa o modo dela ou o padrão Prova.</small></span>
                    </label>
                    <label>
                      <input type="radio" name="tag-preferred-mode" checked={draft.preferredMode === 'exam'} onChange={() => updateDraft({ preferredMode: 'exam' })} />
                      <span><strong>Prova</strong><small>Perguntas independentes.</small></span>
                    </label>
                    <label>
                      <input type="radio" name="tag-preferred-mode" checked={draft.preferredMode === 'conversation'} onChange={() => updateDraft({ preferredMode: 'conversation' })} />
                      <span><strong>Conversa</strong><small>Exploração progressiva.</small></span>
                    </label>
                  </div>
                </fieldset>

                <fieldset className="tag-policy-fields">
                  <legend>Parâmetros</legend>
                  <label><span>Primeira revisão</span><div><input aria-label="Primeira revisão" type="number" min="1" max="3650" value={draft.firstReviewIntervalDays} onChange={(event) => updateDraft({ firstReviewIntervalDays: Number(event.target.value) })} /><small>dias</small></div></label>
                  <label><span>Retenção desejada</span><div><input aria-label="Retenção desejada" type="number" min="50" max="99" value={Math.round(draft.targetRetention * 100)} onChange={(event) => updateDraft({ targetRetention: Number(event.target.value) / 100 })} /><small>%</small></div></label>
                  <label><span>Prioridade na fila</span><div><input aria-label="Prioridade na fila" type="number" min="0.1" max="100" step="0.1" value={draft.priorityWeight} onChange={(event) => updateDraft({ priorityWeight: Number(event.target.value) })} /><small>peso</small></div></label>
                  <label><span>Intervalo mínimo</span><div><input aria-label="Intervalo mínimo" type="number" min="1" max="3650" value={draft.minIntervalDays} onChange={(event) => updateDraft({ minIntervalDays: Number(event.target.value) })} /><small>dias</small></div></label>
                  <label><span>Intervalo máximo</span><div><input aria-label="Intervalo máximo" type="number" min="1" max="36500" value={draft.maxIntervalDays} onChange={(event) => updateDraft({ maxIntervalDays: Number(event.target.value) })} /><small>dias</small></div></label>
                  <label className="tag-deadline-field">
                    <span>Prazo de estudo</span>
                    <div>
                      <input
                        aria-label="Prazo de estudo"
                        type="date"
                        value={deadlineDateValue(draft.deadlineAtUnixMs)}
                        onChange={(event) => updateDraft({ deadlineAtUnixMs: deadlineFromDateInput(event.target.value) })}
                      />
                      <small>opcional</small>
                    </div>
                  </label>
                </fieldset>

                <PolicyWorkloadEstimate
                  firstReviewIntervalDays={draft.firstReviewIntervalDays}
                  targetRetention={draft.targetRetention}
                  minIntervalDays={draft.minIntervalDays}
                  maxIntervalDays={draft.maxIntervalDays}
                  valid={validation.success}
                />

                {!validation.success ? <p className="field-error" role="alert">Revise o nome e os intervalos da tag.</p> : null}
                {duplicate ? <p className="field-error" role="alert">Esta tag já existe no vault.</p> : null}
                <div className="tag-form-actions">
                  <button type="button" className="secondary-button" onClick={cancelEditing} disabled={busy}>Cancelar</button>
                  <button type="button" onClick={() => void requestSave()} disabled={busy || !validation.success || duplicate}>
                    {busy ? 'Calculando impacto…' : mode === 'create' ? 'Revisar criação' : 'Revisar alterações'}
                  </button>
                </div>
              </div>
            </>
          ) : selectedTag && selectedNode ? (
            <div className="tag-folder-detail">
              <div className="tag-detail-heading">
                <div>
                  <p className="card-kicker">{selected ? 'Tag selecionada' : 'Hierarquia de tags'}</p>
                  <h3>
                    {selected ? <Hash size={20} aria-hidden="true" /> : null}
                    {selectedTag}
                  </h3>
                  <p>
                    {selected
                      ? `${selected.notePaths.length} nota${selected.notePaths.length === 1 ? '' : 's'} usa${selected.notePaths.length === 1 ? '' : 'm'} esta tag.`
                      : `${folderNotePaths.length} nota${folderNotePaths.length === 1 ? '' : 's'} em ${folderEntries.length} tag${folderEntries.length === 1 ? '' : 's'} aninhada${folderEntries.length === 1 ? '' : 's'}.`}
                  </p>
                </div>
                <div className="tag-detail-actions">
                  {selected ? (
                    <>
                      <button type="button" className="secondary-button" onClick={startEdit} disabled={busy}><Pencil size={15} aria-hidden="true" />Editar</button>
                      <button type="button" className="secondary-button danger-button" onClick={() => void requestDelete()} disabled={busy}><Trash2 size={15} aria-hidden="true" />Excluir</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => startCreate(selectedTag)}
                      disabled={busy || atRuleLimit}
                      title={atRuleLimit ? 'Limite de 100 regras de tag atingido' : `Criar uma regra de revisão para #${selectedTag}`}
                    >
                      <Settings size={15} aria-hidden="true" />Configurar
                    </button>
                  )}
                </div>
              </div>

              {selected?.rule ? (
                <>
                  <div className={`tag-review-status ${selected.rule.autoEnroll ? 'is-active' : ''}`}>
                    <span><Check size={15} aria-hidden="true" /></span>
                    <div>
                      <strong>{selected.rule.autoEnroll ? 'Revisão automática ativa' : 'Apenas fornece parâmetros'}</strong>
                      <p>{selected.rule.autoEnroll ? 'Notas prontas entram automaticamente na fila de aprendizado.' : 'A política é herdada apenas por notas que já participam da revisão.'}</p>
                    </div>
                  </div>
                  <dl className="tag-policy-summary">
                    <div><dt>Primeira revisão</dt><dd>{selected.rule.firstReviewIntervalDays} dias</dd></div>
                    <div><dt>Retenção desejada</dt><dd>{Math.round(selected.rule.targetRetention * 100)}%</dd></div>
                    <div><dt>Prioridade</dt><dd>{selected.rule.priorityWeight}</dd></div>
                    <div><dt>Intervalo mínimo</dt><dd>{selected.rule.minIntervalDays} dias</dd></div>
                    <div><dt>Intervalo máximo</dt><dd>{selected.rule.maxIntervalDays} dias</dd></div>
                    <div><dt>Prazo de estudo</dt><dd>{selected.rule.deadlineAtUnixMs === null ? 'Sem prazo' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(selected.rule.deadlineAtUnixMs))}</dd></div>
                    <div><dt>Modo herdado</dt><dd>{selected.rule.preferredMode === null ? 'Sem preferência' : selected.rule.preferredMode === 'exam' ? 'Prova' : 'Conversa'}</dd></div>
                  </dl>
                </>
              ) : (
                <div className="tag-unconfigured">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <div>
                    <strong>{selected ? 'Sem política própria' : 'Pasta sem regra própria'}</strong>
                    <p>{selected
                      ? 'Esta tag existe nas notas, mas ainda não altera o agendamento. Clique em Editar para configurá-la.'
                      : 'As tags abaixo existem nas notas, mas esta hierarquia ainda não define um ritmo. Clique em Configurar para criar a regra.'}</p>
                  </div>
                </div>
              )}

              {selected ? (
                <section className="tag-note-list" aria-labelledby="tag-detail-note-list-title">
                  <div><h4 id="tag-detail-note-list-title">Notas com esta tag</h4><span>{selected.notePaths.length}</span></div>
                  {selected.notePaths.length > 0 ? (
                    <ul className="tag-note-flat">
                      {[...selected.notePaths].sort((left, right) => left.localeCompare(right, 'pt-BR')).map((path) => {
                        const clean = path.replace(/\.md$/i, '')
                        const segments = clean.split('/')
                        const name = segments[segments.length - 1] ?? clean
                        const location = segments.slice(0, -1).join('/')
                        return (
                          <li key={path}>
                            <span className="tag-note-flat-name">{name}</span>
                            {location ? <small className="tag-note-flat-location">{location}/</small> : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : <p>Nenhuma nota usa esta tag atualmente.</p>}
                </section>
              ) : null}
            </div>
          ) : (
            <div className="tag-detail-empty">
              <Hash size={30} aria-hidden="true" />
              <h3>Selecione ou crie uma tag</h3>
              <p>As características e notas impactadas aparecerão aqui.</p>
            </div>
          )}

          {error ? (
            <div className="tag-page-error" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>{error}</span>
              <button type="button" className="secondary-button" onClick={() => setReloadToken((value) => value + 1)}>Recarregar</button>
            </div>
          ) : null}
          {success ? <p className="tag-page-success" role="status">{success}</p> : null}
        </main>
      </div>

      <Modal
        open={pending !== null}
        onClose={() => {
          if (!busy) setPending(null)
        }}
        labelledBy="tag-impact-title"
        className="tag-impact-modal"
      >
        {pending ? (
          <>
            <ModalHeader
              title={pending.title}
              titleId="tag-impact-title"
              closeLabel="Fechar confirmação"
              kicker="Confirme o impacto"
              onClose={() => {
                if (!busy) setPending(null)
              }}
            />
            <p>{pending.description}</p>
            <div className="tag-impact-count">
              <strong>{pending.preview.affectedNotePaths.length}</strong>
              <span>nota{pending.preview.affectedNotePaths.length === 1 ? '' : 's'} impactada{pending.preview.affectedNotePaths.length === 1 ? '' : 's'}</span>
            </div>
            <div className="tag-impact-notes">
              {pending.preview.affectedNotePaths.length > 0 ? (
                <ul>{pending.preview.affectedNotePaths.map((path) => <li key={path}>{path}</li>)}</ul>
              ) : <p>Nenhuma nota existente será alterada.</p>}
            </div>
            <div className="tag-impact-actions">
              <button type="button" className="secondary-button" onClick={() => setPending(null)} disabled={busy}>Cancelar</button>
              <button type="button" onClick={() => confirmPending()} disabled={busy}>
                {busy ? 'Aplicando…' : 'Confirmar alteração'}
              </button>
            </div>
          </>
        ) : null}
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => {
          if (!busy) setPendingDelete(null)
        }}
        labelledBy="tag-delete-title"
        className="tag-impact-modal tag-delete-modal"
      >
        {pendingDelete ? (
          <>
            <ModalHeader
              title={pendingDelete.title}
              titleId="tag-delete-title"
              closeLabel="Fechar confirmação"
              kicker="Excluir tag"
              onClose={() => {
                if (!busy) setPendingDelete(null)
              }}
            />
            <p>{pendingDelete.description}</p>

            {pendingDeleteNotes > 0 || pendingDeleteNested > 0 ? (
              <div className="tag-delete-warnings" role="alert">
                {pendingDeleteNotes > 0 ? (
                  <div className="tag-delete-warning">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>
                      <strong>Notas usam esta tag</strong>
                      <small>{pendingDeleteNotes} nota{pendingDeleteNotes === 1 ? '' : 's'} está{pendingDeleteNotes === 1 ? '' : 'm'} associada{pendingDeleteNotes === 1 ? '' : 's'} a esta tag.</small>
                    </span>
                  </div>
                ) : null}
                {pendingDeleteNested > 0 ? (
                  <div className="tag-delete-warning">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <span>
                      <strong>Tags aninhadas</strong>
                      <small>{pendingDeleteNested} tag{pendingDeleteNested === 1 ? '' : 's'} aninhada{pendingDeleteNested === 1 ? '' : 's'} abaixo desta tag — a exclusão remove apenas a regra desta tag, as aninhadas permanecem.</small>
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="tag-impact-count">
              <strong>{pendingDelete.preview.affectedNotePaths.length}</strong>
              <span>nota{pendingDelete.preview.affectedNotePaths.length === 1 ? '' : 's'} impactada{pendingDelete.preview.affectedNotePaths.length === 1 ? '' : 's'}</span>
            </div>
            <label className="tag-delete-option">
              <input
                type="checkbox"
                checked={pendingDelete.change.removeFromNotes}
                onChange={(event) => setPendingDelete({
                  ...pendingDelete,
                  change: { ...pendingDelete.change, removeFromNotes: event.target.checked },
                })}
              />
              <span><strong>Remover também das notas</strong><small>{pendingDelete.change.removeFromNotes ? 'O Markdown das notas abaixo será alterado.' : 'A tag continuará no Markdown como uma tag sem política.'}</small></span>
            </label>
            <div className="tag-impact-notes">
              {pendingDelete.preview.affectedNotePaths.length > 0 ? (
                <ul>{pendingDelete.preview.affectedNotePaths.map((path) => <li key={path}>{path}</li>)}</ul>
              ) : <p>Nenhuma nota existente será alterada.</p>}
            </div>
            <div className="tag-impact-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingDelete(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="danger-button" onClick={() => confirmDelete()} disabled={busy}>
                {busy ? 'Aplicando…' : 'Excluir tag'}
              </button>
            </div>
          </>
        ) : null}
      </Modal>
    </section>
  )
}
