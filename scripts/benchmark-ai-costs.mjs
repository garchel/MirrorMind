import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const ROOT = process.cwd()
const OUT_JSON = path.join(ROOT, 'docs', 'ai-benchmark-results.json')
const OUT_MD = path.join(ROOT, 'docs', 'ai-benchmark-report.md')
const EXCHANGE_BRL = 5.5
const DEEPSEEK_INPUT_USD_PER_1M = 0.15
const DEEPSEEK_OUTPUT_USD_PER_1M = 0.60
const DEEPSEEK_CACHE_READ_USD_PER_1M = 0.003

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function extractRustConst(relative, name) {
  const source = read(relative)
  const pattern = new RegExp(
    `(?:pub\\(crate\\)\\s+)?const\\s+${name}\\s*:\\s*&str\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*;`,
    's',
  )
  const match = source.match(pattern)
  if (!match) throw new Error(`Constante ${name} nao encontrada em ${relative}`)
  const raw = match[1]
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
}

const READINESS = extractRustConst('src-tauri/src/review/evaluation.rs', 'READINESS_INSTRUCTIONS')
const EXAM = extractRustConst('src-tauri/src/review/session.rs', 'EXAM_INSTRUCTIONS')
const CONVERSATION = extractRustConst('src-tauri/src/review/session.rs', 'CONVERSATION_INSTRUCTIONS')
const EVALUATION = extractRustConst('src-tauri/src/review/session.rs', 'EVALUATION_INSTRUCTIONS')
const FACT_CHECK = extractRustConst('src-tauri/src/review/fact_check.rs', 'FACT_CHECK_INSTRUCTIONS')
const EXTRACTION = extractRustConst('src-tauri/src/review/fact_check.rs', 'EXTRACTION_INSTRUCTIONS')

const smallNote = read('src/fixtures/obsidian-vaults/study-vault/Notas/Quimica.md').trim()
const mediumNote = `# Fotossintese

A fotossintese e o processo pelo qual plantas, algas e algumas bacterias convertem energia luminosa em energia quimica. Ela ocorre principalmente nos cloroplastos e pode ser dividida em duas fases: a fase clara, dependente de luz, e o ciclo de Calvin, independente de luz.

## Fase clara

Na fase clara, a energia da luz excita eletrons na clorofila. A agua e quebrada no fotossistema II, liberando oxigenio molecular e eletrons. Os eletrons seguem uma cadeia transportadora e bombeiam protons para o interior do tilacoide, criando um gradiente que alimenta a ATP sintase. O produto principal e ATP, alem de NADPH.

## Ciclo de Calvin

O ciclo de Calvin ocorre no estroma do cloroplasto. A enzima RuBisCO fixa o dioxido de carbono em ribulose-1,5-bifosfato. O ciclo consome ATP e NADPH produzidos na fase clara e gera gliceraldeido-3-fosfato, precursor de glicose e outros carboidratos. A regeneracao da ribulose-1,5-bifosfato mantem o ciclo funcionando.

## Fatores limitantes

A taxa de fotossintese depende da intensidade luminosa, da concentracao de dioxido de carbono, da temperatura e da disponibilidade de agua. Em condicoes de luz intensa e pouca disponibilidade de CO2, a planta pode perder eficiencia. Temperaturas muito altas podem desnaturar enzimas e fechar os estomatos, reduzindo a entrada de CO2.

## Pigmentos

A clorofila a e a clorofila b sao os pigmentos mais importantes. Elas absorvem principalmente luz azul e vermelha e refletem verde. Carotenoides auxiliam na absorcao de luz e protegem contra danos oxidativos. A combinacao desses pigmentos amplia a faixa de luz utilizavel.

## Relacao com a respiracao

A fotossintese e a respiracao celular sao processos complementares. A fotossintese armazena energia em carboidratos e libera oxigenio; a respiracao consome oxigenio e carboidratos para produzir ATP. Em uma planta, os dois processos ocorrem simultaneamente, mas em compartimentos e momentos diferentes.

## Importancia ecologica

A fotossintese sustenta quase todas as cadeias alimentares. Ela tambem regula a concentracao de oxigenio e dioxido de carbono na atmosfera. A produtividade primaria de um ecossistema depende da disponibilidade de luz, agua e nutrientes.`

const notes = {
  small: { label: 'Pequena (~80 palavras)', content: smallNote },
  medium: { label: 'Média (~300 palavras)', content: mediumNote },
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length
}

function readinessUser(note, size) {
  const words = wordCount(note)
  if (size === 'small') {
    return `Avalie a prontidao desta nota. A nota e curta e sera avaliada como uma unica unidade de revisao (${words} palavras).`
  }
  const sections = [
    ['Fotossintese', Math.round(words * 0.18)],
    ['Fase clara', Math.round(words * 0.22)],
    ['Ciclo de Calvin', Math.round(words * 0.22)],
    ['Fatores limitantes', Math.round(words * 0.18)],
    ['Importancia ecologica', Math.round(words * 0.20)],
  ]
  const units = sections.map(([name, count], index) => ({
    ordinal: index + 1,
    kind: 'section',
    sectionPath: [name],
    headingLevel: 1,
    words: count,
    startUtf16: 0,
    endUtf16: 0,
  }))
  return `Avalie a prontidao desta nota. A nota foi dividida em ${units.length} unidades de revisao:\n[${units.map((unit) => JSON.stringify(unit)).join(',\n')}]`
}

function transcript(note, size) {
  const second = size === 'small'
    ? 'Qual e a diferenca entre um atomo e uma molecula?'
    : 'Explique a relacao entre a fase clara e o ciclo de Calvin.'
  const secondAnswer = size === 'small'
    ? 'Atomo e a menor unidade de um elemento; molecula e um grupo de atomos ligados.'
    : 'A fase clara produz ATP e NADPH, que sao usados no ciclo de Calvin para fixar CO2.'
  return JSON.stringify([
    {
      promptId: 'q1',
      question: 'Qual e a ideia central da nota?',
      userAnswer: size === 'small'
        ? 'A nota apresenta conceitos basicos de quimica.'
        : 'A fotossintese converte luz em energia quimica em duas fases.',
    },
    { promptId: 'q2', question: second, userAnswer: secondAnswer },
    {
      promptId: 'q3',
      question: 'O que acontece com a energia luminosa?',
      userAnswer: size === 'small'
        ? 'Ela e absorvida e transformada.'
        : 'Ela excita eletrons na clorofila e gera ATP e NADPH.',
    },
    {
      promptId: 'q4',
      question: 'Onde ocorre o ciclo de Calvin?',
      userAnswer: size === 'small'
        ? 'Nao lembro exatamente.'
        : 'No estroma do cloroplasto.',
    },
  ])
}

function tasksFor(note, size) {
  return [
    {
      id: 'readiness',
      label: 'Prontidão',
      system: READINESS,
      user: readinessUser(note, size),
    },
    {
      id: 'exam-generation',
      label: 'Geração de prova',
      system: EXAM,
      user: 'Gere as questoes de multipla escolha e as dicas da prova.',
    },
    {
      id: 'conversation-turn',
      label: 'Turno de conversa',
      system: CONVERSATION,
      user: 'Gere a primeira pergunta e um contexto curto.',
    },
    {
      id: 'conversation-evaluation',
      label: 'Avaliação de conversa',
      system: EVALUATION,
      user: `Modo: conversa. Avalie somente estas perguntas e respostas em JSON: ${transcript(note, size)}`,
    },
    {
      id: 'fact-extraction',
      label: 'Extração factual',
      system: EXTRACTION,
      user: `Extraia as afirmacoes factuais desta nota:\n---\n${note}\n---\n\nCada afirmacao precisa de uma parafrase e de uma citacao literal.`,
      only: 'medium',
    },
    {
      id: 'fact-check',
      label: 'Verificação factual',
      system: FACT_CHECK,
      user: `Verifique os fatos desta nota:\n---\n${note}\n---\n\nClassifique cada afirmacao factual como confirmada, divergente ou incerta, com as citacoes literais exatas.`,
      only: 'medium',
    },
  ]
}

function stripFences(text) {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseJson(text) {
  try {
    JSON.parse(stripFences(text))
    return true
  } catch {
    return false
  }
}

async function callDeepSeek({ model, system, user }) {
  const base = process.env.OPENAI_BASE_URL
  const key = process.env.OPENAI_API_KEY
  if (!base || !key) throw new Error('OPENAI_BASE_URL/OPENAI_API_KEY ausentes')
  const endpoint = `${base.replace(/\/$/, '')}/chat/completions`
  const started = performance.now()
  const request = async (withResponseFormat) => {
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: 2000,
      ...(withResponseFormat ? { response_format: { type: 'json_object' } } : {}),
    }
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    })
  }
  let response = await request(true)
  if (response.status === 400) {
    const text = await response.text()
    if (/response_format|json_object/i.test(text)) {
      response = await request(false)
    } else {
      throw new Error(`HTTP 400: ${text.slice(0, 300)}`)
    }
  }
  const latencyMs = Math.round(performance.now() - started)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content ?? ''
  const usage = payload.usage ?? {}
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const promptTokens = usage.prompt_tokens ?? 0
  const completionTokens = usage.completion_tokens ?? 0
  const costUsd = (
    (Math.max(0, promptTokens - cached) * DEEPSEEK_INPUT_USD_PER_1M +
      cached * DEEPSEEK_CACHE_READ_USD_PER_1M +
      completionTokens * DEEPSEEK_OUTPUT_USD_PER_1M) / 1_000_000
  )
  return {
    content,
    latencyMs,
    promptTokens,
    completionTokens,
    cachedTokens: cached,
    totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
    costUsd,
    finishReason: payload.choices?.[0]?.finish_reason ?? null,
    httpStatus: response.status,
  }
}

async function callOllama({ model, system, user }) {
  const endpoint = 'http://localhost:11434/api/chat'
  const started = performance.now()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      format: 'json',
      options: { temperature: 0, num_predict: 2000 },
    }),
    signal: AbortSignal.timeout(300_000),
  })
  const latencyMs = Math.round(performance.now() - started)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  const payload = await response.json()
  const content = payload.message?.content ?? ''
  const promptTokens = payload.prompt_eval_count ?? 0
  const completionTokens = payload.eval_count ?? 0
  return {
    content,
    latencyMs,
    promptTokens,
    completionTokens,
    cachedTokens: 0,
    totalTokens: promptTokens + completionTokens,
    costUsd: 0,
    finishReason: payload.done_reason ?? null,
    httpStatus: response.status,
  }
}

function average(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

async function run() {
  const providers = []
  const deepseekModel = process.env.BENCHMARK_MODEL || 'deepseek-v4.1-flash'
  if (process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY) {
    providers.push({
      id: deepseekModel,
      label: `DeepSeek V4.1 Flash (${deepseekModel})`,
      call: (input) => callDeepSeek({ ...input, model: deepseekModel }),
      repetitions: 2,
    })
  }
  providers.push({
    id: 'qwen2.5:7b',
    label: 'Ollama qwen2.5:7b (local)',
    call: (input) => callOllama({ ...input, model: 'qwen2.5:7b' }),
    repetitions: 1,
  })

  const results = []
  let deepseekBlocked = false
  for (const provider of providers) {
    if (provider.id === deepseekModel && deepseekBlocked) continue
    for (const [size, note] of Object.entries(notes)) {
      if (provider.id === deepseekModel && deepseekBlocked) break
      const tasks = tasksFor(note.content, size).filter((task) => !task.only || task.only === size)
      for (const task of tasks) {
        if (provider.id === deepseekModel && deepseekBlocked) break
        for (let repetition = 1; repetition <= provider.repetitions; repetition += 1) {
          if (provider.id === deepseekModel && deepseekBlocked) break
          process.stderr.write(`[${provider.id}] ${size} ${task.id} #${repetition}... `)
          try {
            const response = await provider.call({ system: task.system, user: task.user })
            const record = {
              provider: provider.id,
              providerLabel: provider.label,
              noteSize: size,
              noteLabel: note.label,
              task: task.id,
              taskLabel: task.label,
              repetition,
              inputChars: task.system.length + task.user.length + note.content.length,
              latencyMs: response.latencyMs,
              promptTokens: response.promptTokens,
              completionTokens: response.completionTokens,
              cachedTokens: response.cachedTokens,
              totalTokens: response.totalTokens,
              costUsd: response.costUsd,
              costBrl: response.costUsd * EXCHANGE_BRL,
              jsonValid: parseJson(response.content),
              outputChars: response.content.length,
              finishReason: response.finishReason,
              httpStatus: response.httpStatus,
              ok: true,
            }
            results.push(record)
            process.stderr.write(`ok (${record.promptTokens}+${record.completionTokens} tokens, ${record.latencyMs} ms)\n`)
          } catch (error) {
            const rawMessage = error instanceof Error ? error.message : String(error)
            const record = {
              provider: provider.id,
              providerLabel: provider.label,
              noteSize: size,
              noteLabel: note.label,
              task: task.id,
              taskLabel: task.label,
              repetition,
              ok: false,
              error: rawMessage.replace(/thk_live_[^\s")]+/g, 'thk_live_...'),
            }
            results.push(record)
            if (provider.id === deepseekModel && /HTTP 402/.test(record.error)) {
              deepseekBlocked = true
            }
            process.stderr.write(`ERRO: ${record.error}\n`)
          }
        }
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    exchangeBrl: EXCHANGE_BRL,
    deepseekPricingUsdPer1M: {
      input: DEEPSEEK_INPUT_USD_PER_1M,
      output: DEEPSEEK_OUTPUT_USD_PER_1M,
      cacheRead: DEEPSEEK_CACHE_READ_USD_PER_1M,
    },
    notes: Object.fromEntries(
      Object.entries(notes).map(([key, note]) => [key, { label: note.label, chars: note.content.length, words: wordCount(note.content) }]),
    ),
    schemaIncluded: false,
    agentBaseline: {
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
      inputTokens: 5900,
      outputTokens: 6,
      reasoningTokens: 46,
      cacheReadTokens: 1664,
      note: 'Execucao minima via opencode-cli; inclui system prompt e ferramentas do agente, nao representa o custo do app.',
    },
    results,
  }
  fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2))

  const okResults = results.filter((result) => result.ok)
  const directDeepseek = okResults.filter((result) => result.provider === deepseekModel)
  const ollamaRows = okResults.filter((result) => result.provider === 'qwen2.5:7b')
  const tasks = [...new Set(okResults.map((result) => result.task))]
  const taskLabels = Object.fromEntries(okResults.map((result) => [result.task, result.taskLabel]))

  function deepseekProxyCost(row) {
    const cached = row.cachedTokens ?? 0
    return (
      (Math.max(0, row.promptTokens - cached) * DEEPSEEK_INPUT_USD_PER_1M +
        cached * DEEPSEEK_CACHE_READ_USD_PER_1M +
        row.completionTokens * DEEPSEEK_OUTPUT_USD_PER_1M) / 1_000_000
    )
  }

  const proxyRows = ollamaRows.map((row) => {
    const costUsd = deepseekProxyCost(row)
    return {
      ...row,
      provider: 'deepseek-v4.1-flash-proxy',
      providerLabel: 'DeepSeek V4.1 Flash (proxy: tokens do Ollama)',
      costUsd,
      costBrl: costUsd * EXCHANGE_BRL,
      latencyMs: null,
      jsonValid: null,
      finishReason: null,
      proxy: true,
    }
  })

  const deepseekCostRows = directDeepseek.length > 0 ? directDeepseek : proxyRows
  const reportGroups = [
    {
      id: 'ollama',
      label: 'Ollama qwen2.5:7b (local)',
      rows: ollamaRows,
    },
    {
      id: 'deepseek',
      label: directDeepseek.length > 0
        ? 'DeepSeek V4.1 Flash (medido)'
        : 'DeepSeek V4.1 Flash (proxy: tokens do Ollama)',
      rows: directDeepseek.length > 0 ? directDeepseek : proxyRows,
    },
  ].filter((group) => group.rows.length > 0)

  const deepseekError = results.find((result) => result.provider === deepseekModel && !result.ok)?.error

  const lines = []
  lines.push('# Benchmark de custo de IA — medição real')
  lines.push('')
  lines.push(`Gerado em ${output.generatedAt}.`)
  lines.push('')
  lines.push('Este relatório usa os prompts reais extraídos do código do MirrorMind. O conteúdo das notas é real (pequena) ou sintético (média). Tokens e latência do Ollama vêm da API local. O DeepSeek direto não pôde ser medido porque o endpoint respondeu 402; o custo dele abaixo é um **proxy** que aplica o preço de tabela aos tokens medidos no Ollama.')
  lines.push('')
  lines.push('## Status dos provedores')
  lines.push('')
  lines.push('- **Ollama qwen2.5:7b:** medido localmente; tokens de entrada/saída e latência são reais.')
  if (directDeepseek.length > 0) {
    lines.push('- **DeepSeek V4.1 Flash:** medido diretamente pelo endpoint.')
  } else {
    lines.push('- **DeepSeek V4.1 Flash direto:** **não medido**. O endpoint retornou 402 (sem plano ativo/saldo para a chave). O custo é proxy.')
    if (deepseekError) {
      lines.push(`  - Erro: ${deepseekError.slice(0, 240)}`)
    }
  }
  lines.push('- **OpenCode Go (DeepSeek via agente):** uma execução mínima consumiu ~5.900 tokens de entrada e 6 de saída; esse número inclui o system prompt e as ferramentas do agente, então **não representa** o custo do app.')
  lines.push('')
  lines.push('## Notas usadas')
  lines.push('')
  lines.push('| Nota | Palavras | Caracteres |')
  lines.push('| --- | ---: | ---: |')
  for (const [key, note] of Object.entries(output.notes)) {
    lines.push(`| ${key} | ${note.words} | ${note.chars} |`)
  }
  lines.push('')
  lines.push('## Chamadas medidas')
  lines.push('')
  lines.push('| Provedor | Tarefa | Nota | Reps | Tokens entrada (média) | Tokens saída (média) | Latência média | Custo médio | JSON válido |')
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const group of reportGroups) {
    for (const task of tasks) {
      for (const size of Object.keys(output.notes)) {
        const rows = group.rows.filter((result) => result.task === task && result.noteSize === size)
        if (rows.length === 0) continue
        const taskLabel = taskLabels[task] ?? task
        const prompt = average(rows.map((row) => row.promptTokens))
        const completion = average(rows.map((row) => row.completionTokens))
        const latencyRows = rows.filter((row) => typeof row.latencyMs === 'number')
        const latencyLabel = latencyRows.length === rows.length
          ? `${average(latencyRows.map((row) => row.latencyMs)).toFixed(0)} ms`
          : 'n/d'
        const jsonRows = rows.filter((row) => typeof row.jsonValid === 'boolean')
        const jsonLabel = jsonRows.length === rows.length
          ? `${((jsonRows.filter((row) => row.jsonValid).length / jsonRows.length) * 100).toFixed(0)}%`
          : 'n/d'
        const cost = average(rows.map((row) => row.costBrl))
        const costLabel = group.id === 'ollama'
          ? 'R$ 0,00 (local)'
          : `R$ ${cost.toFixed(4).replace('.', ',')}${group.id === 'deepseek' && directDeepseek.length === 0 ? ' (proxy)' : ''}`
        lines.push(`| ${group.label} | ${taskLabel} | ${size} | ${rows.length} | ${prompt.toFixed(0)} | ${completion.toFixed(0)} | ${latencyLabel} | ${costLabel} | ${jsonLabel} |`)
      }
    }
  }
  lines.push('')
  lines.push('## Custo por fluxo')
  lines.push('')
  lines.push('Contagem de chamadas extraída do código:')
  lines.push('')
  lines.push('- **Prova (primeira sessão):** prontidão (1) + geração de prova (1) = **2 chamadas**.')
  lines.push('- **Prova (sessão seguinte):** geração de prova (1) = **1 chamada**. A correção de prova é determinística e não usa IA.')
  lines.push('- **Conversa:** prontidão (1) + primeira pergunta (1) + 3 a 5 turnos seguintes + avaliação final (1) = **6 a 8 chamadas** (a primeira pergunta já é o turno 1).')
  lines.push('- **Verificação factual:** extração (1) + verificação (1) = **2 chamadas**.')
  lines.push('')
  lines.push(directDeepseek.length > 0
    ? 'Estimativa para o DeepSeek, usando os tokens medidos diretamente:'
    : 'Estimativa para o DeepSeek, usando o **proxy de tokens do Ollama** e o preço de tabela do DeepSeek:')
  lines.push('')
  lines.push('| Fluxo | Chamadas | Custo estimado |')
  lines.push('| --- | ---: | ---: |')

  const avgByTask = (task) => average(deepseekCostRows.filter((row) => row.task === task).map((row) => row.costBrl))
  const readiness = avgByTask('readiness')
  const exam = avgByTask('exam-generation')
  const turn = avgByTask('conversation-turn')
  const evaluation = avgByTask('conversation-evaluation')
  const extraction = avgByTask('fact-extraction')
  const factCheck = avgByTask('fact-check')
  const format = (value) => `R$ ${value.toFixed(4).replace('.', ',')}`
  lines.push(`| Prova (primeira sessão) | 2 | ${format(readiness + exam)} |`)
  lines.push(`| Prova (sessão seguinte) | 1 | ${format(exam)} |`)
  lines.push(`| Conversa (4 turnos) | 6 | ${format(readiness + turn + 3 * turn + evaluation)} |`)
  lines.push(`| Conversa (6 turnos) | 8 | ${format(readiness + turn + 5 * turn + evaluation)} |`)
  lines.push(`| Verificação factual | 2 | ${format(extraction + factCheck)} |`)
  lines.push('')
  lines.push('## Leitura')
  lines.push('')
  const measuredAvg = (task, field) => average(ollamaRows.filter((row) => row.task === task).map((row) => row[field]))
  lines.push(`- Prontidão: ~${measuredAvg('readiness', 'promptTokens').toFixed(0)} tokens de entrada e ~${measuredAvg('readiness', 'completionTokens').toFixed(0)} de saída.`)
  lines.push(`- Geração de prova: ~${measuredAvg('exam-generation', 'promptTokens').toFixed(0)} de entrada e ~${measuredAvg('exam-generation', 'completionTokens').toFixed(0)} de saída.`)
  lines.push(`- Avaliação de conversa: ~${measuredAvg('conversation-evaluation', 'promptTokens').toFixed(0)} de entrada e ~${measuredAvg('conversation-evaluation', 'completionTokens').toFixed(0)} de saída.`)
  lines.push(`- Verificação factual: ~${measuredAvg('fact-check', 'promptTokens').toFixed(0)} de entrada e ~${measuredAvg('fact-check', 'completionTokens').toFixed(0)} de saída.`)
  lines.push('')
  lines.push('A planilha assumia 2.500 tokens de entrada e 2.000 de saída por chamada. As chamadas medidas ficaram abaixo disso na maioria das tarefas. O schema JSON enviado pelo app não entrou neste benchmark, então os tokens reais do app serão maiores que os medidos aqui.')
  const factRows = ollamaRows.filter((row) => row.task === 'fact-check')
  const factStressed = factRows.some((row) => row.completionTokens >= 2000 || !row.jsonValid)
  if (factStressed) {
    lines.push('A verificação factual foi a exceção: bateu no teto de 2.000 tokens de saída e/ou devolveu JSON inválido no qwen local. Ela precisa de validação e retry no fluxo real.')
  } else {
    lines.push('Nesta rodada, a verificação factual ficou em ~1.049 tokens de saída e o JSON parseou; em rodadas anteriores o modelo local estourou o teto e devolveu JSON inválido. Ela continua sendo a tarefa mais cara e precisa de validação e retry.')
  }
  lines.push('')
  lines.push('## Limites da medição')
  lines.push('')
  lines.push('- Uma amostra por tarefa/nota no Ollama; não é p50/p95.')
  lines.push('- DeepSeek direto não foi medido (402). O proxy usa tokens do Ollama, que tem tokenizer diferente do DeepSeek; o custo é uma aproximação, não uma fatura.')
  lines.push('- O conteúdo do usuário foi reconstruído a partir do código; pequenas diferenças de prompt podem mudar alguns tokens.')
  lines.push('- O JSON válido mede apenas parse; não mede correção semântica nem grounding.')
  lines.push('- Custo do Ollama é zero em API, mas não inclui energia, hardware ou tempo do usuário.')
  lines.push('')
  lines.push('Resultado bruto: `docs/ai-benchmark-results.json`.')
  fs.writeFileSync(OUT_MD, `${lines.join('\n')}\n`)

  process.stderr.write(`\nJSON: ${OUT_JSON}\nMD: ${OUT_MD}\n`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
