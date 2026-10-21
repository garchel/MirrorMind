import { useState } from 'react'
import {
  alignSuggestions,
  type AlignedSuggestion,
} from './noteImprovementAlign'

/**
 * Comparacao lado a lado entre a nota como esta e a nota com as sugestoes.
 *
 * ## O que o highlight faz
 *
 * Passar o mouse em um bloco **inserido** destaca, no lado "antes", o bloco
 * que a sugestao explica. E vice-versa. E o que liga as duas metades sem
 * numeração e sem setas: o usuario ve "esta frase_la explica" apontando para
 * o trecho original.
 *
 * ## Por que nao ha diff
 *
 * Todas as edicoes sao aditivas, entao o alinhamento e 1:1 mais os blocos
 * inseridos. Um diff geral aqui mostraria blocos destacados que nao
 * correspondem ao que seria inserido — pior que nao mostrar nada.
 */
export function NoteImprovementDiff({
  before,
  suggestions,
}: {
  before: string
  suggestions: { term: string; definition: string; sourceQuote: string }[]
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const aligned = alignSuggestions(before, suggestions)

  if (!aligned.length) {
    return (
      <p className="review-improvement-empty">
        Nenhuma sugestão pôde ser ancorada nesta nota.
      </p>
    )
  }

  return (
    <div className="review-improvement-diff">
      {aligned.map((suggestion) => (
        <DiffPair
          key={suggestion.id}
          suggestion={suggestion}
          hovered={hovered}
          onHover={setHovered}
        />
      ))}
    </div>
  )
}

function DiffPair({
  suggestion,
  hovered,
  onHover,
}: {
  suggestion: AlignedSuggestion
  hovered: number | null
  onHover: (id: number | null) => void
}) {
  const isActive = hovered === suggestion.id
  return (
    <section
      className={`review-improvement-pair${isActive ? ' is-active' : ''}`}
      onMouseEnter={() => onHover(suggestion.id)}
      onMouseLeave={() => onHover(null)}
    >
      <header className="review-improvement-pair-header">
        <strong>{suggestion.term}</strong>
        <span>termo sem definição na nota</span>
      </header>
      <div className="review-improvement-columns">
        <div className="review-improvement-column">
          <p className="review-improvement-column-label">Antes</p>
          {suggestion.before.map((block, index) => (
            <p
              key={`before-${index}`}
              className={
                block.text.includes(suggestion.sourceQuote) ? 'is-anchored' : undefined
              }
            >
              {block.text}
            </p>
          ))}
        </div>
        <div className="review-improvement-column">
          <p className="review-improvement-column-label">Depois</p>
          {suggestion.after.map((block, index) => (
            <p
              key={`after-${index}`}
              className={
                block.kind === 'inserted'
                  ? 'is-inserted'
                  : block.text.includes(suggestion.sourceQuote)
                    ? 'is-anchored'
                    : undefined
              }
            >
              {block.text}
            </p>
          ))}
        </div>
      </div>
    </section>
  )
}
