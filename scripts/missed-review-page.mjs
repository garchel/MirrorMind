#!/usr/bin/env node
/**
 * Gera a pagina de revisao dos termos esperados que o motor nao encontrou.
 *
 * A revisao dos extras mostrou que a lista do revisor pode estar incompleta -
 * e ela tambem pode exigir demais. Dos 23 termos ausentes na rodada 4, alguns
 * sao variacoes de nome (a metrica resolve), alguns o motor recusou (o
 * julgamento resolve) e alguns nunca foram propostos (a geracao resolve).
 * Antes de consertar qualquer um, e preciso saber se o termo **deveria** estar
 * no gabarito: `estroma` as vezes e so nomeado na nota, e exigir definicao ali
 * e uma cobranca que o leitor nao faria.
 *
 * A pagina mostra, por termo, a frase onde ele aparece, a etapa em que ele
 * morreu e o resto do gabarito do caso. As decisoes saem em JSON com
 * `reviewer: "human"`.
 *
 * Uso:
 *   node scripts/missed-review-page.mjs [report.json] [saida.html]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const reportPath = resolve(process.argv[2] ?? 'docs/jev-eval-report.json')
const outPath = resolve(process.argv[3] ?? 'docs/jev-missed-review.html')
const goldenPath = resolve('src-tauri/tests/fixtures/jev-golden/golden.json')
const notesDir = join(dirname(goldenPath), 'cases')

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const byId = new Map(golden.cases.map((entry) => [entry.id, entry]))
const recall = report.definitionRecall ?? {}

function fold(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function termsMatch(left, right) {
  const a = fold(left)
  const b = fold(right)
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  if (shorter.length < 5) return false
  return longer.startsWith(shorter) || longer.endsWith(shorter)
}

/** "caso: termo (motivo)" -> { caseId, term, reason }. */
function parseRejected(line, withReason) {
  const at = line.indexOf(': ')
  if (at < 0) return null
  const caseId = line.slice(0, at)
  const rest = line.slice(at + 2)
  if (!withReason) return { caseId, term: rest, reason: null }
  const reasonAt = rest.lastIndexOf(' (')
  if (reasonAt < 0) return { caseId, term: rest, reason: null }
  return {
    caseId,
    term: rest.slice(0, reasonAt),
    reason: rest.slice(reasonAt + 2, -1),
  }
}

const filtered = (recall.rejectedByFilter ?? [])
  .map((line) => parseRejected(line, true))
  .filter(Boolean)
const engineRejected = (recall.rejectedByEngine ?? [])
  .map((line) => parseRejected(line, false))
  .filter(Boolean)
const acceptedUnmatched = (recall.acceptedUnmatchedTerms ?? [])
  .map((line) => parseRejected(line, false))
  .filter(Boolean)

/** A lista de ausentes, estruturada quando o relatorio novo ja traz. */
function missedList() {
  if (Array.isArray(recall.missedTerms)) {
    return recall.missedTerms.map((entry) => ({
      caseId: entry.caseId,
      term: entry.term,
      stage: entry.stage,
      proposedAs: entry.proposedAs ?? null,
      detail: null,
    }))
  }
  // Relatorio antigo: `missedCases` e "caso: termo1, termo2, ...". A etapa e
  // inferida das listas que o relatorio ja guarda.
  const entries = []
  for (const line of recall.missedCases ?? []) {
    const at = line.indexOf(': ')
    if (at < 0) continue
    const caseId = line.slice(0, at)
    for (const term of line.slice(at + 2).split(', ')) {
      const variant = acceptedUnmatched.find(
        (entry) => entry.caseId === caseId && termsMatch(entry.term, term),
      )
      if (variant) {
        entries.push({
          caseId,
          term,
          stage: 'nameVariant',
          proposedAs: variant.term,
          detail: null,
        })
        continue
      }
      const byEngine = engineRejected.find(
        (entry) => entry.caseId === caseId && termsMatch(entry.term, term),
      )
      if (byEngine) {
        entries.push({
          caseId,
          term,
          stage: 'rejectedByEngine',
          proposedAs: byEngine.term,
          detail: null,
        })
        continue
      }
      const byFilter = filtered.find(
        (entry) => entry.caseId === caseId && termsMatch(entry.term, term),
      )
      if (byFilter) {
        entries.push({
          caseId,
          term,
          stage: 'rejectedByFilter',
          proposedAs: byFilter.term,
          detail: byFilter.reason,
        })
        continue
      }
      entries.push({ caseId, term, stage: 'neverProposed', proposedAs: null, detail: null })
    }
  }
  return entries
}

const STAGE = {
  neverProposed: {
    label: 'nunca proposto',
    question: 'O motor nunca ofereceu este termo. Ele precisa de definição nesta nota?',
  },
  rejectedByEngine: {
    label: 'recusado pelo motor',
    question: 'O motor viu o termo e disse que já está claro. Ele precisa de definição?',
  },
  rejectedByFilter: {
    label: 'recusado pelo filtro',
    question: 'O filtro recusou antes do motor. Ele precisa de definição nesta nota?',
  },
  nameVariant: {
    label: 'variação de nome',
    question: 'O motor achou o mesmo conhecimento com outro nome. É o mesmo termo?',
  },
}

const items = []
for (const entry of missedList()) {
  const goldenCase = byId.get(entry.caseId)
  const note = goldenCase ? readFileSync(join(notesDir, goldenCase.note), 'utf8') : ''
  const paragraphs = note.split(/\n\s*\n/).filter((block) => block.trim())
  const foldedTerm = fold(entry.term)
  const paragraph =
    paragraphs.find((block) => fold(block).includes(foldedTerm)) ?? note
  items.push({
    ...entry,
    paragraph: paragraph.trim(),
    stageLabel: STAGE[entry.stage]?.label ?? entry.stage,
    question: STAGE[entry.stage]?.question ?? '',
    expected: (goldenCase?.expectedDefinitions ?? []).map((item) => item.term),
    definition:
      (recall.acceptedTerms ?? []).find(
        (accepted) =>
          accepted.caseId === entry.caseId && termsMatch(accepted.term, entry.term),
      )?.definition ?? null,
  })
}

items.sort((left, right) => left.caseId.localeCompare(right.caseId) || left.term.localeCompare(right.term))

const counts = items.reduce((accumulator, item) => {
  accumulator[item.stage] = (accumulator[item.stage] ?? 0) + 1
  return accumulator
}, {})

for (const stage of Object.keys(STAGE)) {
  console.log(`${STAGE[stage].label}: ${counts[stage] ?? 0}`)
}

const data = {
  runId: report.runId,
  generatedAt: new Date().toISOString(),
  items,
}

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisar termos ausentes — rodada ${report.runId}</title>
<style>
  :root {
    --ink: #1d1c1a; --muted: #6b6862; --line: #e2ddd6; --bg: #faf8f5;
    --card: #fffdfa; --mark: #fff0b8; --ok: #2f6b4f; --warn: #8a6a1f;
    --bad: #8c3a3a; --alt: #38598a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { position: sticky; top: 0; z-index: 10; background: rgba(250,248,245,.94);
    backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); padding: 16px 24px 12px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 19px; margin: 0 0 4px; letter-spacing: -.01em; }
  .meta { color: var(--muted); font-size: 13px; }
  .bar { display: flex; gap: 12px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
  .progress { flex: 1 1 220px; height: 8px; background: #ece7df; border-radius: 99px; overflow: hidden; }
  .progress > i { display: block; height: 100%; width: 0; background: var(--ok); transition: width .2s ease; }
  .count { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); }
  button { font: inherit; font-size: 13px; padding: 7px 12px; border: 1px solid var(--line);
    background: #fff; color: var(--ink); border-radius: 8px; cursor: pointer; }
  button:hover { border-color: #c9c2b8; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--alt); outline-offset: 2px; }
  button.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
  main { max-width: 980px; margin: 0 auto; padding: 20px 24px 80px; }
  .intro { color: var(--muted); font-size: 14px; margin: 0 0 20px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 18px 20px; margin-bottom: 14px; }
  .card.done { border-color: #cfd8d0; background: #fbfdfb; }
  .top { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .case { font-size: 12px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
  .term { font: 600 18px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tag { font-size: 11px; padding: 2px 7px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted); }
  .tag.stage { border-color: #d9cfae; color: var(--warn); background: #fdf8e9; }
  .sugg { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
  .sugg b { color: var(--ink); font-weight: 600; }
  blockquote { margin: 14px 0; padding: 12px 14px; background: #f6f2ea;
    border-left: 3px solid #d8d1c4; border-radius: 0 8px 8px 0; font-size: 15px; white-space: pre-wrap; }
  mark { background: var(--mark); color: inherit; padding: 0 2px; border-radius: 3px; }
  .expected { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--muted); }
  .chip { font: 12px ui-monospace, monospace; background: #f1ede6; border-radius: 6px; padding: 2px 7px; color: #4a463f; }
  .proposed { margin: 10px 0 0; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 8px;
    font-size: 14px; color: #4a463f; background: #fcfaf6; }
  .decide { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .decide button { min-width: 150px; }
  .decide button[aria-pressed="true"] { color: #fff; border-color: transparent; }
  .decide button[data-v="precisa"][aria-pressed="true"] { background: var(--bad); }
  .decide button[data-v="nao_precisa"][aria-pressed="true"] { background: var(--warn); }
  .decide button[data-v="variante"][aria-pressed="true"] { background: var(--alt); }
  .obs { margin-top: 10px; width: 100%; padding: 8px 10px; border: 1px solid var(--line);
    border-radius: 8px; font: inherit; font-size: 13px; background: #fff; }
  .empty { color: var(--muted); font-size: 14px; }
  footer.note { margin-top: 28px; color: var(--muted); font-size: 13px; }
  @media (max-width: 560px) {
    header, main { padding-left: 14px; padding-right: 14px; }
    .term { font-size: 16px; }
    .decide button { min-width: 100%; }
  }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>Revisar os termos que faltaram</h1>
    <div class="meta">Rodada ${report.runId} · ${items.length} termos esperados que o motor não encontrou (nome exato)</div>
    <div class="bar">
      <div class="progress" role="progressbar" aria-label="Termos revisados"><i id="fill"></i></div>
      <span class="count" id="count">0 de ${items.length}</span>
      <button id="filter">Ver só pendentes</button>
      <button class="primary" id="export">Baixar decisões (.json)</button>
    </div>
  </div>
</header>
<main>
  <p class="intro">
    Cada cartão é um termo que o gabarito espera e o motor não achou. A pergunta
    aqui é <strong>ao contrário</strong> da revisão dos extras: não é "o motor
    aceitou demais?", é "o gabarito está cobrando o termo certo?". As decisões
    ficam salvas neste navegador e saem no botão de download.
    <br><strong>Precisa</strong> = o motor errou · <strong>Não precisa</strong> = o gabarito exigiu demais,
    o termo sai · <strong>É variante</strong> = o motor achou com outro nome, a métrica resolve.
  </p>
  <div id="list"></div>
  <footer class="note">
    A etapa é onde o termo morreu: nunca proposto, recusado pelo filtro, recusado pelo motor ou achado
    com outro nome. Ela já diz qual conserto resolve — esta revisão decide se há algo a consertar.
  </footer>
</main>
<script>
const DATA = ${JSON.stringify(data).replaceAll('<', '\\u003c')};
const KEY = 'jev-missed-review-' + DATA.runId;
const VERDICTS = ['precisa', 'nao_precisa', 'variante'];
const LABEL = { precisa: 'Precisa', nao_precisa: 'Não precisa', variante: 'É variante' };
let state = load();

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
function keyOf(item) { return item.caseId + '|' + item.term; }
function esc(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function highlight(text, term) {
  const words = term.split(/\\s+/).filter(Boolean).map((word) =>
    word.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'));
  const pattern = new RegExp('(' + words.join('[\\\\s,.;:]+') + ')', 'gi');
  return esc(text).replace(pattern, '<mark>$1</mark>');
}

function render() {
  const list = document.getElementById('list');
  const onlyPending = document.getElementById('filter').dataset.on === '1';
  const visible = DATA.items.filter((item) => !onlyPending || !state[keyOf(item)]);
  list.innerHTML = visible.length === 0
    ? '<p class="empty">Nada pendente. Baixe as decisões.</p>'
    : visible.map(card).join('');
  updateProgress();
}

function updateProgress() {
  const done = DATA.items.filter((item) => state[keyOf(item)]).length;
  document.getElementById('count').textContent = done + ' de ' + DATA.items.length;
  document.getElementById('fill').style.width = (DATA.items.length ? (done / DATA.items.length) * 100 : 0) + '%';
}

function card(item) {
  const decision = state[keyOf(item)] || {};
  const buttons = VERDICTS.map((verdict) => {
    const pressed = decision.verdict === verdict ? 'true' : 'false';
    return '<button type="button" data-act="v" data-case="' + esc(item.caseId)
      + '" data-term="' + esc(item.term) + '" data-v="' + verdict
      + '" aria-pressed="' + pressed + '">' + LABEL[verdict] + '</button>';
  }).join('');
  return '<article class="card' + (decision.verdict ? ' done' : '') + '">'
    + '<div class="top"><span class="case">' + esc(item.caseId.replaceAll('-', ' ')) + '</span>'
    + '<span class="term">' + esc(item.term) + '</span>'
    + '<span class="tag stage">' + esc(item.stageLabel) + '</span>'
    + '</div>'
    + '<p class="sugg"><b>Pergunta:</b> ' + esc(item.question) + '</p>'
    + (item.detail ? '<p class="sugg"><b>Motivo do filtro:</b> ' + esc(item.detail) + '</p>' : '')
    + '<blockquote>' + highlight(item.paragraph, item.term) + '</blockquote>'
    + (item.definition
      ? '<p class="proposed"><b>O motor propôs:</b> ' + esc(item.definition) + '</p>'
      : '')
    + '<div class="expected"><span>Gabarito do caso:</span>'
    + (item.expected.length
      ? item.expected.map((term) => '<span class="chip">' + esc(term) + '</span>').join('')
      : '<em>o revisor não esperava nenhum termo</em>')
    + '</div>'
    + '<div class="decide">' + buttons + '</div>'
    + '<input class="obs" data-act="obs" data-case="' + esc(item.caseId)
    + '" data-term="' + esc(item.term) + '" placeholder="Observação (opcional)" value="'
    + esc(decision.note || '') + '">'
    + '</article>';
}

document.getElementById('list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-act="v"]');
  if (!button) return;
  const article = button.closest('.card');
  const item = { caseId: button.dataset.case, term: button.dataset.term };
  const key = keyOf(item);
  const current = state[key] || {};
  const verdict = button.dataset.v;
  const next = current.verdict === verdict ? undefined : verdict;
  state[key] = { ...current, verdict: next };
  if (!state[key].verdict) delete state[key];
  persist();

  const decided = state[key]?.verdict;
  article.classList.toggle('done', Boolean(decided));
  for (const peer of article.querySelectorAll('.decide button')) {
    peer.setAttribute('aria-pressed', String(peer.dataset.v === decided));
  }
  const onlyPending = document.getElementById('filter').dataset.on === '1';
  if (onlyPending && decided) article.remove();
  updateProgress();
});

document.getElementById('list').addEventListener('input', (event) => {
  const input = event.target.closest('input[data-act="obs"]');
  if (!input) return;
  const item = { caseId: input.dataset.case, term: input.dataset.term };
  state[keyOf(item)] = { ...(state[keyOf(item)] || {}), note: input.value };
  if (!state[keyOf(item)].verdict && !input.value.trim()) delete state[keyOf(item)];
  persist();
});

document.getElementById('filter').addEventListener('click', (event) => {
  const on = event.currentTarget.dataset.on === '1' ? '0' : '1';
  event.currentTarget.dataset.on = on;
  event.currentTarget.textContent = on === '1' ? 'Ver todos' : 'Ver só pendentes';
  render();
});

function payload() {
  const decisions = DATA.items
    .filter((item) => state[keyOf(item)]?.verdict)
    .map((item) => ({
      caseId: item.caseId,
      term: item.term,
      stage: item.stage,
      verdict: state[keyOf(item)].verdict,
      note: state[keyOf(item)].note || '',
    }));
  const summary = {};
  for (const verdict of VERDICTS) {
    summary[verdict] = decisions.filter((entry) => entry.verdict === verdict).length;
  }
  return {
    kind: 'jev-missed-review',
    runId: DATA.runId,
    reviewer: 'human',
    reviewedAt: new Date().toISOString(),
    decisions,
    summary,
  };
}

document.getElementById('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'jev-missed-review-' + DATA.runId + '.json';
  link.click();
  URL.revokeObjectURL(url);
});

render();
</script>
</body>
</html>
`

writeFileSync(outPath, html, 'utf8')
console.log(`pagina em ${outPath} (${items.length} termos)`)
