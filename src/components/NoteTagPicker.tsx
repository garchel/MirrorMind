import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, X } from 'lucide-react'
import { getNoteReviewState, reviewAiErrorMessage, type NoteReviewState } from '../features/review/ai'
import { getVaultReviewPolicyConfig, type VaultReviewPolicyConfig } from '../features/review/vaultReviewPolicy'
import { Modal } from './Modal'
import './NoteTagPicker.css'

type NoteTagPickerProps = {
  availableTags: string[]
  onApply: (tag: string) => void
  relativePath: string
  tags: string[]
  vaultPath: string
}

export function NoteTagPicker({ availableTags, onApply, relativePath, tags, vaultPath }: NoteTagPickerProps) {
  const [isOpen, setOpen] = useState(false)
  const [isLoading, setLoading] = useState(false)
  const [policyConfig, setPolicyConfig] = useState<VaultReviewPolicyConfig | null>(null)
  const [reviewState, setReviewState] = useState<NoteReviewState | null>(null)
  const [pendingTag, setPendingTag] = useState<string | null>(null)
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  const selectableTags = [...new Set([...availableTags, ...(policyConfig?.tagRules.map((rule) => rule.tag) ?? [])])]
    .filter((tag) => !tags.includes(tag))
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))

  // Fecha o menu ao clicar fora do componente ou pressionar Escape.
  useEffect(() => {
    if (!isOpen) return
    function closeOnOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', closeOnOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', closeOnOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    let active = true
    setLoading(true)
    setError('')
    void Promise.all([
      getVaultReviewPolicyConfig(vaultPath),
      getNoteReviewState({ vaultPath, relativePath }),
    ])
      .then(([nextConfig, nextReviewState]) => {
        if (!active) return
        setPolicyConfig(nextConfig)
        setReviewState(nextReviewState)
      })
      .catch((cause) => {
        if (active) setError(reviewAiErrorMessage(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [isOpen, relativePath, vaultPath])

  const pendingRule = pendingTag ? policyConfig?.tagRules.find((rule) => rule.tag === pendingTag) ?? null : null
  const shouldAssessFirst = Boolean(pendingRule?.autoEnroll && reviewState?.readiness !== 'ready')

  function closeImpact() {
    setPendingTag(null)
    triggerRef.current?.focus()
  }

  function confirmApply() {
    if (!pendingTag) return
    onApply(pendingTag)
    closeImpact()
  }

  return (
    <div className="note-tag-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="note-tag-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Tags associadas a nota"
        title="Adicionar ou remover tags"
      >
        <span>tags:</span>
        <ChevronDown size={12} aria-hidden="true" className="note-tag-picker-chevron" />
      </button>

      {isOpen ? (
        <div className="note-tag-picker-menu" role="menu" aria-label="Tags existentes">
          {isLoading ? <p>Carregando tags…</p> : null}
          {error ? <p role="alert">Não foi possível carregar os detalhes de revisão.</p> : null}
          {!isLoading && selectableTags.length === 0 ? <p>Nenhuma tag disponível para aplicar.</p> : null}
          {!isLoading && !error ? selectableTags.map((tag) => (
            <button key={tag} type="button" role="menuitem" onClick={() => { setPendingTag(tag); setOpen(false) }}>
              #{tag}
            </button>
          )) : null}
        </div>
      ) : null}

      {pendingTag ? (
        <Modal
          open
          onClose={closeImpact}
          labelledBy="note-tag-impact-title"
          className="note-tag-impact-modal"
        >
          <section>
            <div className="note-tag-impact-heading">
              <div><p className="card-kicker">Impacto da tag</p><h3 id="note-tag-impact-title">Aplicar #{pendingTag}</h3></div>
              <button type="button" className="secondary-button" onClick={closeImpact} aria-label="Fechar impacto"><X size={16} /></button>
            </div>
            <p>Esta nota passará a usar a tag <strong>#{pendingTag}</strong>.</p>
            <dl className="note-tag-impact-summary">
              <div><dt>Tags atuais</dt><dd>{tags.length}</dd></div>
              <div><dt>Após aplicar</dt><dd>{tags.length + 1}</dd></div>
            </dl>
            {pendingRule?.autoEnroll ? (
              <div className="note-tag-review-warning" role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                <div>
                  <strong>Revisão automática ativa</strong>
                  <p>{shouldAssessFirst ? 'Faça a avaliação da nota antes de aplicar esta tag para confirmar que ela está pronta para revisão.' : 'A nota está pronta para revisão e poderá ser incluída automaticamente na fila.'}</p>
                </div>
              </div>
            ) : null}
            <div className="note-tag-impact-actions">
              <button type="button" className="secondary-button" onClick={closeImpact}>Cancelar</button>
              <button type="button" onClick={confirmApply}>Aplicar tag</button>
            </div>
          </section>
        </Modal>
      ) : null}
    </div>
  )
}
