// Acrescenta a secao do MirrorMind (fora do bloco do GitNexus) ao AGENTS.md
// e ao CLAUDE.md.
//
//   node scripts/append-mirror-mind-section.mjs <secao.md>
//
// ## Por que um script, e nao edicao direta
//
// O GitNexus reescreve o bloco entre `<!-- gitnexus:start -->` e
// `<!-- gitnexus:end -->`, e **preserva** o que esta fora dos marcadores
// (o `upsertGitNexusSection` faz `before + content + after`). Mas um
// arquivo de 45 linhas gerado por ferramenta, reescrito a cada `analyze`,
// e o pior lugar para uma edicao manual: qualquer `analyze` pode voltar
// com o arquivo diferente do que foi revisado.
//
// Este script faz a edicao de forma **idempotente**: a secao e removida e
// reinserida, entao rodar duas vezes nao duplica nada, e a secao do
// MirrorMind fica sempre no fim do arquivo.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const [sectionPath] = process.argv.slice(2)
if (!sectionPath) {
  console.error('uso: node scripts/append-mirror-mind-section.mjs <secao.md>')
  process.exit(1)
}
if (!existsSync(resolve(sectionPath))) {
  console.error(`nao achei: ${sectionPath}`)
  process.exit(1)
}

const START = '<!-- mirror-mind:start -->'
const END = '<!-- mirror-mind:end -->'
const GITNEXUS_END = '<!-- gitnexus:end -->'

const section = readFileSync(resolve(sectionPath), 'utf8').trim()
const block = `${START}\n${section.replace(/^<!-- mirror-mind:start -->\n?/, '').replace(/\n?<!-- mirror-mind:end -->$/, '')}\n${END}`

const targets = ['AGENTS.md', 'CLAUDE.md']
for (const target of targets) {
  if (!existsSync(resolve(target))) {
    console.log(`${target}: nao existe, pulando`)
    continue
  }
  let content = readFileSync(resolve(target), 'utf8')

  // Remove a secao anterior, se houver.
  const startIndex = content.indexOf(START)
  const endIndex = content.indexOf(END)
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    content = content.slice(0, startIndex).trimEnd() + '\n\n' + content.slice(endIndex + END.length).trimStart()
  }

  // A secao do MirrorMind fica **depois** do bloco do GitNexus: assim a
  // ferramenta reescreve o dela sem tocar na nossa, e a nossa nao
  // interfere no bloco gerado.
  const anchor = content.indexOf(GITNEXUS_END)
  if (anchor === -1) {
    content = `${content.trimEnd()}\n\n${block}\n`
  } else {
    const cut = anchor + GITNEXUS_END.length
    content = `${content.slice(0, cut).trimEnd()}\n\n${block}\n${content.slice(cut).trimStart()}`
  }

  writeFileSync(resolve(target), `${content.trimEnd()}\n`, 'utf8')
  console.log(`${target}: secao do MirrorMind atualizada`)
}
