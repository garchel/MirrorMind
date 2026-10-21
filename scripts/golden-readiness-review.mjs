// Exporta o pacote de revisao dos ROTULOS DE PRONTIDAO.
//
//   node scripts/golden-readiness-review.mjs --file
//
// ## Para que outro modelo julgue
//
// As 19 **sinteses** ja foram revisadas (ver `golden-review-gemini.json`). Falta
// o outro lado: o **rotulo de prontidao** de cada nota — `ready`,
// `ambiguous` ou `insufficient`.
//
// Sao coisas diferentes, e a distincao importa:
//   - a revisao das sinteses pergunta "o TEXTOwritten demonstra a dimensao?"
//   - a revisao dos rotulos pergunta "a NOTA tem material suficiente?"
//
// ## A pergunta e mais factual do que parece
//
// O rotulo de prontidao responde a criterios enumeraveis, e por isso um
// revisor cuidadoso concorda com a rubrica:
//
// - `ready`      -> ideia central identificavel, pelo menos 3 paragrafos com
//                   frase propria, nenhum termo usado como premissa sem
//                   definicao, e nenhuma contradicao entre paragrafos.
// - `ambiguous`  -> pelo menos UM destes: premissa com termo indefinido, duas
//                   afirmacoes mutuamente exclusivas, ou conteudo delegado a
//                   anexos.
// - `insufficient` -> so listas, tarefas, imagens de anexo ou remissoes.
//
// ## O que a folha NAO pergunta
//
// Ela nao pergunta "o JEV acertou?". Essa e a pergunta que a **medicao** faz
// depois, comparando a regua do motor com a sua revisao. Se a folha
// perguntasse, o revisor estaria so concordando com o motor.
//
// ## O aviso de leniencia
//
// O modo de falha conhecido deste tipo de revisao e a **leniencia**: um
// revisor tender a dizer "ready" porque a nota parece completa. Por isso o
// prompt exige, para cada caso, a **evidencia contra** o rotulo proposto — e
// a lista das razoes pelas quais a nota poderia ser pior. Se a evidencia
// contra for vazia, o revisor escreve isso explicitamente.
//
// A review das 19 sinteses mostrou que vale: o revisor deu muitos `no` e
// `partial`, e achou 13 lacunas inventadas e 8 afirmacoes sem lastro.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const goldenPath = join(
  root,
  'src-tauri',
  'tests',
  'fixtures',
  'jev-golden',
  'golden.json',
)
const casesDir = join(root, 'src-tauri', 'tests', 'fixtures', 'jev-golden', 'cases')

const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

const lines = []
lines.push('# Revisão dos rótulos de prontidão do golden set')
lines.push('')
lines.push('Cada bloco é uma nota com o rótulo que o conjunto propõe. Julgue se o')
lines.push('rótulo está certo.')
lines.push('')
lines.push('## Como julgar')
lines.push('')
lines.push('A rubrica (a mesma que o app usa):')
lines.push('')
lines.push('- **`ready`** — ideia central identificável, pelo menos 3 parágrafos com')
lines.push('  frase própria, nenhum termo usado como premissa sem definição, e nenhuma')
lines.push('  contradição entre parágrafos.')
lines.push('- **`ambiguous`** — pelo menos UM destes: premissa com termo indefinido; duas')
lines.push('  afirmações mutuamente exclusivas sobre o mesmo objeto; ou conteúdo')
lines.push('  delegado a anexos.')
lines.push('- **`insufficient`** — só listas, tarefas, imagens de anexo ou remissões. Nenhuma')
lines.push('  afirmação avaliável.')
lines.push('')
lines.push('**Para cada caso, procure a evidência CONTRA o rótulo proposto antes de')
lines.push('responder.** Se ela for vazia, escreva isso — mas a ausência de evidência')
lines.push('contra não é evidência a favor. As respostas `ambiguous` e `insufficient` são')
lines.push('tão válidas quanto `ready`.')
lines.push('')
lines.push('**Cite a frase da nota** que sustenta a sua leitura. É o que permite')
lines.push('auditar a revisão depois.')
lines.push('')
lines.push('Responda **apenas** com o JSON do bloco.')
lines.push('')
lines.push('---')
lines.push('')

for (const entry of golden.cases) {
  const note = readFileSync(join(casesDir, entry.note), 'utf8').trim()
  lines.push(`## CASO \`${entry.id}\``)
  lines.push('')
  lines.push(`Rótulo proposto: \`${entry.readiness.label}\``)
  if (entry.readiness.why) {
    lines.push('')
    lines.push(`Regra que o conjunto afirma ter seguido: _${entry.readiness.why}_`)
  }
  lines.push('')
  lines.push('### A NOTA')
  lines.push('')
  lines.push('```')
  lines.push(note)
  lines.push('')
  lines.push('```')
  lines.push('')
  lines.push('### SUAS RESPOSTAS')
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push(`  "caseId": "${entry.id}",`)
  lines.push('  "proposed": "' + entry.readiness.label + '",')
  lines.push('  "agreed": null,')
  lines.push('  "label": "",')
  lines.push('  "evidenceAgainst": "",')
  lines.push('  "evidenceFor": "",')
  lines.push('  "notes": ""')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('---')
  lines.push('')
}

const output = lines.join('\n')
const target = join(root, 'docs', 'golden-readiness-review.md')
writeFileSync(target, `${output}\n`, 'utf8')
console.log(`pacote em ${target} (${golden.cases.length} casos)`)
