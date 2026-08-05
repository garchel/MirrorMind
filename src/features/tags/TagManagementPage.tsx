import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Hash, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
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

export function TagManagementPage({ vaultPath, onTagsChanged }: Props) {
  const [config, setConfig] = useState<VaultReviewPolicyConfig | null>(null)
  const [tagIndex, setTagIndex] = useState<TagSummary[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view')
  const [draft, setDraft] = useState<TagReviewPolicyRule>(() => draftFor(''))
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<PendingChange | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const generationRef = useRef(0)

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
        setSelectedTag((current) => (
          current && nextEntries.some((entry) => entry.tag === current)
            ? current
            : nextEntries[0]?.tag ?? null
        ))
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
  const filteredEntries = entries.filter((entry) => (
    entry.tag.includes(normalizeTagInput(query))
  ))
  const selected = entries.find((entry) => entry.tag === selectedTag) ?? null
  const validation = tagReviewPolicyRuleSchema.safeParse(draft)
  const duplicate = entries.some((entry) => (
    entry.tag === draft.tag && (mode === 'create' || entry.tag !== selectedTag)
  ))

  function selectTag(tag: string) {
    if (busy) return
    setSelectedTag(tag)
    setMode('view')
    setPending(null)
    setError('')
    setSuccess('')
  }

  function startCreate() {
    setSelectedTag(null)
    setDraft(draftFor(''))
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
    if (!selectedTag && entries[0]) setSelectedTag(entries[0].tag)
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
      setPending({
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

  async function confirmPending() {
    if (!config || !pending) return
    const generation = generationRef.current
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const result = await applyTagManagementChange({
        vaultPath,
        expectedRevision: config.revision,
        tagRules: pending.tagRules,
        change: pending.change,
        expectedAffectedNotePaths: pending.preview.affectedNotePaths,
      })
      if (generationRef.current !== generation) return
      const nextIndex = await getTagIndex(vaultPath)
      if (generationRef.current !== generation) return
      setConfig(result.config)
      setTagIndex(nextIndex)
      const nextSelected = pending.change.nextTag
      setSelectedTag(nextSelected)
      setMode('view')
      setPending(null)
      setSuccess(
        `${pending.preview.affectedNotePaths.length} nota(s) atualizada(s).`
        + (result.markdownNotePaths.length > 0
          ? ` A tag foi alterada no Markdown de ${result.markdownNotePaths.length} nota(s).`
          : ''),
      )
      await onTagsChanged?.(result.markdownNotePaths)
    } catch (cause) {
      setPending(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generationRef.current === generation) setBusy(false)
    }
  }

  const form = mode === 'create' || mode === 'edit'

  return (
    <section className="tag-management-page" aria-labelledby="tag-management-title">
      <header className="tag-management-header">
        <div>
          <p className="card-kicker">Organização e aprendizado</p>
          <h2 id="tag-management-title">Tags do vault</h2>
          <p>Gerencie a classificação das notas e a política de revisão que cada tag transmite.</p>
        </div>
        <button type="button" onClick={startCreate} disabled={busy || loading}>
          <Plus size={16} aria-hidden="true" />
          Criar tag
        </button>
      </header>

      <div className="tag-management-layout">
        <aside className="tag-catalog" aria-label="Tags existentes">
          <label className="tag-search">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Buscar tags</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar tag"
            />
          </label>
          <div className="tag-catalog-summary">
            <span>{entries.length} tags</span>
            <span>{entries.filter((entry) => entry.rule?.autoEnroll).length} ativam revisão</span>
          </div>
          {loading ? <p className="tag-page-state" role="status">Carregando tags…</p> : null}
          {!loading && filteredEntries.length === 0 ? (
            <div className="tag-empty-state">
              <Hash size={22} aria-hidden="true" />
              <strong>{entries.length === 0 ? 'Nenhuma tag ainda' : 'Nenhum resultado'}</strong>
              <p>{entries.length === 0 ? 'Crie a primeira tag para organizar o vault.' : 'Tente outro termo de busca.'}</p>
            </div>
          ) : null}
          <div className="tag-catalog-list">
            {filteredEntries.map((entry) => (
              <button
                type="button"
                key={entry.tag}
                className={entry.tag === selectedTag ? 'is-selected' : ''}
                onClick={() => selectTag(entry.tag)}
                aria-pressed={entry.tag === selectedTag}
              >
                <span className="tag-catalog-name"><Hash size={14} aria-hidden="true" />{entry.tag}</span>
                <span className="tag-catalog-meta">
                  <small>{entry.notePaths.length} nota{entry.notePaths.length === 1 ? '' : 's'}</small>
                  <i className={entry.rule?.autoEnroll ? 'is-review-on' : ''} aria-label={entry.rule?.autoEnroll ? 'Revisão automática ativa' : 'Revisão automática inativa'} />
                </span>
              </button>
            ))}
          </div>
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
          ) : selected ? (
            <>
              <div className="tag-detail-heading">
                <div>
                  <p className="card-kicker">Tag selecionada</p>
                  <h3><Hash size={22} aria-hidden="true" />{selected.tag}</h3>
                  <p>{selected.notePaths.length} nota{selected.notePaths.length === 1 ? '' : 's'} usa{selected.notePaths.length === 1 ? '' : 'm'} esta tag.</p>
                </div>
                <div className="tag-detail-actions">
                  <button type="button" className="secondary-button" onClick={startEdit} disabled={busy}><Pencil size={15} aria-hidden="true" />Editar</button>
                  <button type="button" className="secondary-button danger-button" onClick={() => void requestDelete()} disabled={busy}><Trash2 size={15} aria-hidden="true" />Excluir</button>
                </div>
              </div>

              {selected.rule ? (
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
                  </dl>
                </>
              ) : (
                <div className="tag-unconfigured">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <div><strong>Sem política própria</strong><p>Esta tag existe nas notas, mas ainda não altera o agendamento. Clique em Editar para configurá-la.</p></div>
                </div>
              )}

              <section className="tag-note-list" aria-labelledby="tag-note-list-title">
                <div><h4 id="tag-note-list-title">Notas com esta tag</h4><span>{selected.notePaths.length}</span></div>
                {selected.notePaths.length > 0 ? (
                  <ul>{selected.notePaths.map((path) => <li key={path}>{path.replace(/\.md$/i, '')}<small>{path}</small></li>)}</ul>
                ) : <p>Nenhuma nota usa esta tag atualmente.</p>}
              </section>
            </>
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

      {pending ? (
        <div className="tag-impact-backdrop" role="presentation">
          <section className="tag-impact-modal" role="dialog" aria-modal="true" aria-labelledby="tag-impact-title">
            <div className="tag-impact-heading">
              <div><p className="card-kicker">Confirme o impacto</p><h3 id="tag-impact-title">{pending.title}</h3></div>
              <button type="button" className="secondary-button tag-icon-button" onClick={() => setPending(null)} disabled={busy} aria-label="Fechar confirmação"><X size={16} /></button>
            </div>
            <p>{pending.description}</p>
            <div className="tag-impact-count">
              <strong>{pending.preview.affectedNotePaths.length}</strong>
              <span>nota{pending.preview.affectedNotePaths.length === 1 ? '' : 's'} impactada{pending.preview.affectedNotePaths.length === 1 ? '' : 's'}</span>
            </div>
            {pending.change.nextTag === null ? (
              <label className="tag-delete-option">
                <input
                  type="checkbox"
                  checked={pending.change.removeFromNotes}
                  onChange={(event) => setPending({
                    ...pending,
                    change: { ...pending.change, removeFromNotes: event.target.checked },
                  })}
                />
                <span><strong>Remover também das notas</strong><small>{pending.change.removeFromNotes ? 'O Markdown das notas abaixo será alterado.' : 'A tag continuará no Markdown como uma tag sem política.'}</small></span>
              </label>
            ) : null}
            <div className="tag-impact-notes">
              {pending.preview.affectedNotePaths.length > 0 ? (
                <ul>{pending.preview.affectedNotePaths.map((path) => <li key={path}>{path}</li>)}</ul>
              ) : <p>Nenhuma nota existente será alterada.</p>}
            </div>
            <div className="tag-impact-actions">
              <button type="button" className="secondary-button" onClick={() => setPending(null)} disabled={busy}>Cancelar</button>
              <button type="button" className={pending.change.nextTag === null ? 'danger-button' : ''} onClick={() => void confirmPending()} disabled={busy}>
                {busy ? 'Aplicando…' : pending.change.nextTag === null ? 'Excluir tag' : 'Confirmar alteração'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
