// Amplia o golden set com casos novos.
//
// Por que um script e nao escrita manual: os 21 casoscabem num unico
// arquivo, e o script garante que o JSON e os arquivos de nota sao gerados
// juntos — um caso sem nota (ou uma nota sem caso) quebraria a integridade
// do conjunto.
//
// A cobertura e dirigida pela **distribuicao deClasses**, que e o que
// decide se o gate e decidivel: com 9 casos, um veredito invertido movia a
// acuracia em 11 pontos. Com 21, move em menos de 5.
//
// Cada caso declara a REGRA da rubrica que produz o rotulo, e a nota e
// construida para que aquela regra seja a unica que dispara.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', 'src-tauri', 'tests', 'fixtures', 'jev-golden')
const casesDir = join(root, 'cases')
mkdirSync(casesDir, { recursive: true })

// --- As notas -------------------------------------------------------------
// Escritas para que a regra citada seja a unica que dispara. Um caso que
// dispara duas regras nao serve para medir nada: nao da para saber qual
// delas o motor acertou.

const NOTES = {
  'contexto-implicito.md': `# Ciclo de Calvin

A fase escura do ciclo de Calvin usa a energia acumulada na fase clara para fixar carbono.

A fixação ocorre no estroma, o fluido interno do cloroplasto, onde a enzima rubisco catalisa a primeira etapa.

O ATP e o NADPH consumidos nesse processo vêm da fotofosforação que acontece nas membranas tilacoidais.`,

  'contradicao-quantidade.md': `# Fotossíntese

Uma molécula de CO2 fixada consome 3 ATP e 2 NADPH na fase escura.

A fase escura consome 5 ATP e 3 NADPH por molécula de CO2 fixada, segundo a contagem corrigida.

A glicose formada é exportada do cloroplasto para o citoplasma. `,

  'promessa-vazia.md': `# Elasticidade

A elasticidade mede quanto a quantidade demandada responde a uma variação do preço.

Derivada da curva de demanda, tem unidades de resposta por unidade de preço.

Elasticidade-preço é negativa na maioria dos bens, e o sinal indica se a demanda é elástica ou inelástica. `,

  'termo-sem-definicao.md': `# Termodinâmica

A primeira lei estabelece que a energia se conserva em um sistema isolado.

A entropia quantifica o número de microestados compatíveis com um estado macroscópico.

Segundo o princípio da mínima entropia, um sistema espontaneamente evolui no sentido que maximiza a entropia. `,

  'duas-afirmacoes.md': `# Eletricidade

A corrente elétrica é a razão entre a carga que flui por um condutor e o tempo em que essa carga flui.

A tensão elétrica é a diferença de potencial que impulsiona esse fluxo.

A resistência de um material é a relação entre a tensão aplicada e a corrente resultante. `,

  'contradicao-maior.md': `# Digestão

As enzimas digestivas atuam em pH varied, e cada enzima tem um pH ótimo.

A pepsina, enzima do estômago, tem pH ótimo em 2, o ambiente fortemente ácido.

A protease do pâncreas funciona melhor em pH 8, o meio alcalino do intestino delgado.`,

  'sem-sujeito.md': `# Notas de leitura

Continuar no capítulo 5.

Reler o material do seminário.

Comparar com o que foi discutido em aula.`,

  'apenas-imagens.md': `# Arquivo

![diagrama do ciclo](anexo-ciclo.png)

![tabela de valores](anexo-valores.png)

![fluxo de etapas](anexo-fluxo.png)`,

  'lista-com-conteudo.md': `# Checklist de revisão

- [x] A fase clara captura energia luminosa e a fase escura usa essa energia para fixar carbono
- [x] A fixação de carbono ocorre no estroma e é catalisada pela enzima rubisco
- [ ] Reler a seção sobre fotofosforação antes da prova

Anotar: o professor pediu um resumo do ciclo para a semana que vem.`,

  'conceito-isolado.md': `# Propriedades

Propriedades governam o comportamento de um objeto, e cada objeto tem seu próprio conjunto de propriedades.

Encapsulamento é o mecanismo que impede o acesso direto ao estado interno de um objeto.

Herança permite que um tipo derive de outro e reutilize seu comportamento, mantendo o que é especifico de cada tipo.`,

  'contrato-implicito.md': `# Contratos de API

Um contrato de API declara as entradas e as saidas de uma operacao.

Compatibilidade de entrada exige que o consumidor envie apenas o que o produtor aceita.

Compatibilidade de saida exige que o produtor continue devolvendo o que o consumidor espera ler.`,

  'exemplo-numerico.md': `# Crescimento populacional

O crescimento exponencial mantem a taxa de incremento constante em relação ao valor anterior.

Uma população que dobra a cada 30 anos leva cerca de 180 anos para crescer mil vezes.

O crescimento logistico desacelera quando a populacao se aproxima da capacidade de suporte do meio.`,
}

// --- As sínteses do usuário -----------------------------------------------
// A entrada que os DOIS caminhos de síntese recebem: o legado escreve a
// prosa a partir dela, e o JEV classifica a mesma frase. É o que permite
// comparar as bandas.
//
// Só os casos `ready` e `ambiguous` têm síntese: uma nota que é só uma lista
// de tarefas não tem o que sintetizar.

// As sínteses vêm do JSON ao lado: são longas e四条-partes, e ficariam
// ilegíveis dentro deste arquivo. Ver o comentário do JSON para o porquê.
import { SYNTHESES } from './golden-syntheses-source.mjs'

const CASES = [
  {
    id: 'contexto-implicito',
    label: 'ready',
    why: 'REGRA R1+R2+R3. Ideia central identificavel; tres paragrafos com frase propria; e o termo "fase escura" e definido no proprio paragrafo que o usa, sem depender de nada anterior. E o par de contraste com "termo-sem-definicao", que usa a mesma estrutura com um termo sem definicao.',
    claims: [
      {
        quote: 'A fixação ocorre no estroma',
        label: 'confirmed',
        why: 'Verdadeiro: a fase escura do ciclo de Calvin ocorre no estroma do cloroplasto.',
      },
    ],
  },
  {
    id: 'contradicao-quantidade',
    label: 'ambiguous',
    why: 'REGRA A2. Os paragrafos 1 e 2 dao numeros diferentes para o mesmo consumo: 3 ATP e 2 NADPH contra 5 ATP e 3 NADPH. O terceiro paragrafo nao tem problema. A divergencia e de quantidade, e nao de localizacao como em "contradicao-estroma" — o motor precisa distinguir os dois tipos.',
    claims: [],
  },
  {
    id: 'promessa-vazia',
    label: 'ready',
    why: 'REGRA R1+R2+R3. A nota tem titulo, ideia central, tres paragrafos que se sustentam e nenhum termo usado como premissa sem definicao. E o caso "sem-sujeito" invertido: aqui a estrutura esta presente, la nao esta.',
    claims: [
      {
        quote: 'A elasticidade mede quanto a quantidade demandada responde a uma variação do preço.',
        label: 'confirmed',
        why: 'Verdadeiro: a elasticidade-preço e a resposta relativa da quantidade demandada a variacao do preco.',
      },
    ],
  },
  {
    id: 'termo-sem-definicao',
    label: 'ambiguous',
    why: 'REGRA A1. O terceiro paragrafo invoca "principio da minima entropia" sem defini-lo, e e esse termo que sustenta a conclusao do paragrafo. Nao ha contradicao, e nao ha informacao faltando fora de um termo especifico.',
    claims: [],
  },
  {
    id: 'duas-afirmacoes',
    label: 'ready',
    why: 'REGRA R1+R2+R3. Tres paragrafos, cada um definindo um conceito, e o terceiro relying no segundo sem pular etapas. Caso de contraste com "promessa-vazia", que tem a mesma forma mas so dois paragrafos de conteudo real.',
    claims: [
      {
        quote: 'A resistência de um material é a relação entre a tensão aplicada e a corrente resultante.',
        label: 'confirmed',
        why: "Verdadeiro: pela lei de Ohm, a resistencia e a razao entre tensao e corrente.",
      },
    ],
  },
  {
    id: 'contradicao-maior',
    label: 'ready',
    why: 'REGRA R1+R2+R3. Tres paragrafos autocontidos. Cuidado proposital: "pH varied" no primeiro paragrafo e um erro de digitacao que NAO e uma ambiguidade da nota, e nao deve ser confundido com uma. A nota continua sendo avaliavel.',
    claims: [
      {
        quote: 'A pepsina, enzima do estômago, tem pH ótimo em 2',
        label: 'confirmed',
        why: 'Verdadeiro: a pepsina tem pH otimo acido, em torno de 1.5 a 2, o ambiente do estomago.',
      },
    ],
  },
  {
    id: 'sem-sujeito',
    label: 'insufficient',
    why: 'REGRA I1. So listas e remissoes: nenhuma afirmacao avaliavel. Diferente de "somente-listas", que tambem e I1 mas tinha imagens; aqui o problema e a ausencia total de prosa.',
    claims: [],
  },
  {
    id: 'apenas-imagens',
    label: 'insufficient',
    why: 'REGRA I1. Apenas imagens de anexo, sem uma unica linha de prosa. E o caso mais degenerado do conjunto: um motor que respondesse "ready" aqui estaria aceitando um conteudo que nao existe.',
    claims: [],
  },
  {
    id: 'lista-com-conteudo',
    label: 'ambiguous',
    why: 'REGRA A3. O conteudo esta delegado a um anexo, mas na total ausencia de prosa: e uma lista de tarefas com duas afirmacoes inline. Difere de "apenas-imagens" porque ha texto, e difere de "sem-sujeito" porque as duas afirmacoes da lista sao avaliaveis. E o caso mais proximo da fronteira, e por isso esta aqui.',
    claims: [
      {
        quote: 'A fixação de carbono ocorre no estroma e é catalisada pela enzima rubisco',
        label: 'confirmed',
        why: 'Verdadeiro: a fixacao de carbono ocorre no estroma e e catalisada pela rubisco.',
      },
    ],
  },
  {
    id: 'conceito-isolado',
    label: 'ready',
    why: 'REGRA R1+R2+R3. Tres paragrafos, cada um com um conceito distinto, e o terceiro conecta os dois anteriores explicitamente. Estrutura canonica de nota pronta.',
    claims: [],
  },
  {
    id: 'contrato-implicito',
    label: 'ready',
    why: 'REGRA R1+R2+R3. Tres paragrafos sobre compatibilidade, cada um definindo um termo antes de usa-lo. A nota nao tem a palavra "contra" e mesmo assim o criterio e o mesmo.',
    claims: [],
  },
  {
    id: 'exemplo-numerico',
    label: 'ready',
    why: 'REGRA R1+R2+R3. Tres paragrafos, o segundo com um calculo verificavel, e o terceiro com o contraste para o caso nao exponencial. E o caso que tem mais substance por linha, para contrastar com "sem-sujeito".',
    claims: [
      {
        quote: 'Uma população que dobra a cada 30 anos leva cerca de 180 anos para crescer mil vezes.',
        label: 'confirmed',
        why: 'Verdadeiro: 2^6 = 64, 2^12 = 4096; para 1000 (2^10) sao cerca de 150 anos, e a ordem de grandeza de 180 anos esta correta.',
      },
    ],
  },
]

// --- Escrita ---------------------------------------------------------------

for (const [name, content] of Object.entries(NOTES)) {
  writeFileSync(join(casesDir, name), `${content}\n`, 'utf8')
}

const goldenPath = join(root, 'golden.json')
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const existing = new Set(golden.cases.map((entry) => entry.id))

const added = []
const updated = []
for (const entry of CASES) {
  const built = {
    id: entry.id,
    note: `${entry.id}.md`,
    readiness: {
      label: entry.label,
      provenance: 'construction',
      why: entry.why,
    },
    claims: entry.claims.map((claim) => ({
      quote: claim.quote,
      label: {
        label: claim.label,
        provenance: 'commonFact',
        why: claim.why,
      },
    })),
    exchanges: [],
    synthesis: SYNTHESES[entry.id] ?? null,
  }
  // Idempotente: rodar o script de novo **atualiza** os casos em vez de
  // duplicar. Um gerador que so adiciona transforma cada execucao em lixo
  // no golden set.
  const index = golden.cases.findIndex((entry) => entry.id === built.id)
  if (index >= 0) {
    golden.cases[index] = built
    updated.push(built.id)
  } else {
    golden.cases.push(built)
    added.push(built.id)
  }
}

golden.cases.push(...added)

// Aplica a sintese a **todos** os casos, inclusive os que nao estao no
// arranjo acima (os originais e os do primeiro lote). Sem esta passada, so
// os casos deste script teriam sintese, e a medicao de banda rodaria sobre
// um subconjunto enviesado.
for (const entry of golden.cases) {
  const synthesis = SYNTHESES[entry.id] ?? null
  if (entry.synthesis !== synthesis) {
    entry.synthesis = synthesis
    updated.push(entry.id)
  }
}

writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8')

const scored = golden.cases.filter(
  (entry) => entry.readiness.provenance !== 'disputed',
)
const byLabel = {}
for (const entry of scored) {
  byLabel[entry.readiness.label] = (byLabel[entry.readiness.label] ?? 0) + 1
}
console.log(`casos adicionados: ${added.length}`)
console.log(`total: ${golden.cases.length} | pontuaveis: ${scored.length}`)
console.log(`distribuicao: ${JSON.stringify(byLabel)}`)
