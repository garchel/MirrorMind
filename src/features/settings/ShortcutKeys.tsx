import { formatShortcut } from '../../lib/keyboard-shortcuts'

/**
 * As teclas de um atalho, como chips de teclado.
 *
 * Era um `input` somente-leitura: mostrava "Ctrl+Shift+F" como texto e pedia
 * que o usuário clicasse para capturar. Agora as teclas aparecem como `kbd`,
 * que é o que o olho procura, e o botão continua capturando a combinação.
 *
 * Captura só com modificador (ou tecla de função): sem isso, um clique seguido
 * de Enter/Esc gravaria "Enter" como atalho.
 */
type Props = {
  keys: string
  label: string
  invalid?: boolean
  onCapture: (combo: string) => void
}

export function ShortcutKeys({ keys, label, invalid = false, onCapture }: Props) {
  const parts = keys.split('+').filter(Boolean)

  return (
    <button
      type="button"
      className="settings-shortcut-keys"
      aria-label={`Atalho para ${label.toLowerCase()}: ${keys}. Clique e pressione a nova combinação.`}
      aria-invalid={invalid || undefined}
      title="Clique e pressione a nova combinação"
      onKeyDown={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey && !/^F\d{1,2}$/.test(event.key)) return
        event.preventDefault()
        onCapture(formatShortcut(event.nativeEvent))
      }}
    >
      {parts.map((part, index) => (
        <span key={part} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {index > 0 ? <span className="settings-shortcut-plus" aria-hidden="true">+</span> : null}
          <kbd>{part}</kbd>
        </span>
      ))}
    </button>
  )
}
