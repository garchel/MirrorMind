/** Prepara uma citacao do relatorio de prontidao para exibicao como Markdown,
 *  tolerando dois defeitos comuns da extracao do modelo:
 *  1. Equacoes LaTeX citadas sem os delimitadores `$$...$$` (o modelo costuma
 *     extrair o conteudo do bloco, nao os cifroes) — sem os delimitadores o
 *     KaTeX nao reconhece a matematica e o texto cru com barras vira poluicao
 *     visual. Se a citacao inteira parece uma unica expressao LaTeX, envolve-a
 *     em `$$...$$` para renderizar como matematica.
 *  2. `**` desbalanceado numa linha (resto de negrito cortado pela extracao,
 *     ex.: `Local:** Tilacoides.` sem o fechamento) — linha com numero impar
 *     de `**` esta quebrada e renderiza asteriscos literais; remove-os. */
export function prepareReportMarkdown(content: string): string {
  let next = content
  const trimmed = next.trim()
  if (
    !trimmed.includes('$')
    && !trimmed.includes('\n')
    && /\\[A-Za-z]+/.test(trimmed)
  ) {
    next = `$$${trimmed}$$`
  }
  return next
    .split('\n')
    .map((line) => {
      const matches = line.match(/\*\*/g)
      if (matches && matches.length % 2 === 1) {
        return line.replace(/\*\*/g, '')
      }
      return line
    })
    .join('\n')
}
