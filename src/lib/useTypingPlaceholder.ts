import { useEffect, useRef, useState } from 'react'

type Opcoes = {
  /** ms por caractere ao escrever (padrao 75). */
  typeMs?: number
  /** ms por caractere ao apagar (padrao 35). */
  eraseMs?: number
  /** ms com a frase completa na tela (padrao 1600). */
  holdMs?: number
  /** ms de pausa com o campo vazio antes da proxima frase (padrao 420). */
  pauseMs?: number
}

/**
 * Placeholder que se escreve e se apaga sozinho, alternando entre frases.
 *
 * Serve para ensinar o que o campo aceita sem gastar espaco com texto fixo:
 * "Buscar nota" e "Buscar tag" se alternam no mesmo campo.
 *
 * Regras:
 * - com `prefers-reduced-motion`, fica na primeira frase e nao anima — texto
 *   piscando e exatamente o tipo de coisa que essa preferencia pede para parar;
 * - a primeira frase ja aparece montada (sem piscar um campo vazio na abertura)
 *   e o ciclo comeca apagando-a;
 * - `setTimeout` encadeado, nunca `setInterval`: cada passo depende do texto
 *   atual, e um intervalo fixo dessincroniza quando a aba perde o foco.
 */
export function useTypingPlaceholder(phrases: string[], opcoes: Opcoes = {}): string {
  const { typeMs = 75, eraseMs = 35, holdMs = 1600, pauseMs = 420 } = opcoes
  const chave = phrases.join('|')
  const primeira = phrases[0] ?? ''
  const [texto, setTexto] = useState(primeira)

  // Espelho sincrono do texto: o proximo passo precisa do valor atual sem
  // esperar um render (o `setTimeout` roda fora do ciclo do React).
  const textoRef = useRef(primeira)

  useEffect(() => {
    if (phrases.length === 0 || typeof window === 'undefined') return

    const semMovimento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (semMovimento) {
      textoRef.current = primeira
      setTexto(primeira)
      return
    }

    let indice = 0
    let apagando = false
    let vivo = true
    let timer: number | undefined

    const agendar = (ms: number) => {
      timer = window.setTimeout(passo, ms)
    }

    const passo = () => {
      if (!vivo) return
      const frase = phrases[indice % phrases.length]
      const atual = textoRef.current
      const proximo = apagando ? frase.slice(0, Math.max(0, atual.length - 1)) : frase.slice(0, atual.length + 1)

      textoRef.current = proximo
      setTexto(proximo)

      // Frase completa: segura na tela e depois comeca a apagar.
      if (!apagando && proximo === frase) {
        agendar(holdMs)
        apagando = true
        return
      }

      // Campo vazio: troca de frase e comeca a escrever a proxima.
      if (apagando && proximo === '') {
        apagando = false
        indice += 1
        agendar(pauseMs)
        return
      }

      agendar(apagando ? eraseMs : typeMs)
    }

    // Abre apagando a primeira frase, que ja esta na tela.
    apagando = true
    agendar(holdMs)

    return () => {
      vivo = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
    // `phrases` e recriado pelo chamador a cada render: comparar pelo conteudo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, typeMs, eraseMs, holdMs, pauseMs])

  return texto
}
