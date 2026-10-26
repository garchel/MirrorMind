#!/usr/bin/env node
/**
 * Gera a pagina de revisao dos termos que o motor aceitou fora do gabarito.
 *
 * A auditoria do agente (`docs/jev-extras-audit.md`) classificou os extras,
 * mas a classificacao nao vale como ground truth sem confirmacao humana. Esta
 * pagina mostra, para cada termo, a frase onde ele aparece e a lista do
 * revisor — o que e preciso para decidir sem abrir 11 notas.
 *
 * A pagina e um arquivo unico, sem servidor e sem rede: as decisoes ficam no
 * localStorage e saem por download ou por copia.
 *
 * Uso:
 *   node scripts/extras-review-page.mjs [report.json] [saida.html]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const reportPath = resolve(process.argv[2] ?? 'docs/jev-eval-report.json')
const outPath = resolve(process.argv[3] ?? 'docs/jev-extras-review.html')
const goldenPath = resolve('src-tauri/tests/fixtures/jev-golden/golden.json')
const notesDir = join(dirname(goldenPath), 'cases')

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
const byId = new Map(golden.cases.map((entry) => [entry.id, entry]))

/**
 * A classificacao do agente, por `caso|termo normalizado`.
 *
 * `why` e a justificativa que aparece no cartao; `verdict` e o que os botoes
 * marcam como sugestao. Termo novo (de uma rodada futura) entra sem sugestao.
 */
const AUDIT = {
  'ciclo-calvin|fase escura': {
    verdict: 'legitimo',
    why: 'A nota diz "produto da fase escura do ciclo de Calvin" e nunca explica o que e a fase escura. E premissa, nao assunto.',
  },
  'ciclo-calvin|fase clara': {
    verdict: 'legitimo',
    why: 'Aparece em "produzidos na fase clara": o leitor precisa saber o que e a fase clara para entender de onde vem o ATP.',
  },
  'termodinamica|adiabatico': {
    verdict: 'variante',
    why: 'E o mesmo termo que o gabarito chama de "recipiente adiabatico": quem define o recipiente define o adiabatico.',
  },
  'bases-de-dados|consistencia': {
    verdict: 'legitimo',
    why: 'Entra no teorema CAP e volta como "criterio menos negociavel" sem nunca ser definida.',
  },
  'contradicao-estroma|ciclo de calvin': {
    verdict: 'assunto',
    why: 'E o mecanismo que da nome ao caso; definir o ciclo inteiro nao ajuda quem le a nota sobre ele.',
  },
  'contradicao-estroma|glicose': {
    verdict: 'legitimo',
    why: 'A nota fala em "molecula de glicose" sem dizer o que e. Termo de dominio, usado como premissa.',
  },
  'referencia-indefinida|ciclo de calvin': {
    verdict: 'assunto',
    why: 'Mesmo caso do anterior: e o assunto, nao uma premissa lateral.',
  },
  'termo-definido-inline|tempo logarithmico': {
    verdict: 'legitimo',
    why: 'A nota promete "busca em tempo logarithmico" e nao explica a notacao; e exatamente o tipo de termo que o caso quer que se ache.',
  },
  'termo-definido-inline|complexidade media de busca': {
    verdict: 'legitimo',
    why: 'Usado como metrica sem definicao, na mesma frase que cita tabelas hash.',
  },
  'contexto-implicito|ciclo de calvin': {
    verdict: 'assunto',
    why: 'Aqui e literalmente o titulo da nota: o leitor ja sabe que a nota e sobre isso.',
  },
  'contexto-implicito|membranas tilacoidais': {
    verdict: 'legitimo',
    why: 'Aparece no fim ("nas membranas tilacoidais") sem definicao previa. A nota define estroma inline, mas nao isto.',
  },
  'contradicao-quantidade|fase escura': {
    verdict: 'legitimo',
    why: 'Premissa repetida nas duas frases que se contradizem; o leitor precisa dela para julgar a contradicao.',
  },
  'termo-sem-definicao|energia': {
    verdict: 'erro',
    why: 'Grandeza fundamental: defini-la na nota nao melhora a leitura. O revisor esperava "sistema isolado", que e a premissa real da frase.',
  },
  'lista-com-conteudo|fixacao de carbono': {
    verdict: 'legitimo',
    why: 'O processo e nomeado duas vezes e nunca explicado — nem no checklist, nem no lembrete.',
  },
  'exemplo-numerico|capacidade de suporte do meio': {
    verdict: 'variante',
    why: 'E o mesmo termo que o gabarito chama de "capacidade de suporte", com o complemento que a nota usa.',
  },
}

/** Minusculas sem acento, para casar termo e texto sem depender de digitacao. */
function fold(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const extras = report.definitionRecall?.acceptedUnmatchedTerms ?? []
const items = []

for (const line of extras) {
  const at = line.indexOf(': ')
  if (at < 0) continue
  const caseId = line.slice(0, at)
  const term = line.slice(at + 2)
  const entry = byId.get(caseId)
  const note = entry ? readFileSync(join(notesDir, entry.note), 'utf8') : ''
  const paragraphs = note.split(/\n\s*\n/).filter((block) => block.trim())
  const foldedTerm = fold(term)
  const paragraph =
    paragraphs.find((block) => fold(block).includes(foldedTerm)) ?? note
  const audit = AUDIT[`${caseId}|${foldedTerm}`] ?? null
  items.push({
    caseId,
    term,
    paragraph: paragraph.trim(),
    expected: (entry?.expectedDefinitions ?? []).map((item) => item.term),
    inTitle: fold(paragraph.split('\n')[0]).includes(foldedTerm) &&
      paragraph.trim().startsWith('#'),
    suggested: audit?.verdict ?? null,
    why: audit?.why ?? null,
  })
}

// Ordena por caso para o revisor nao pular de assunto em assunto.
items.sort((left, right) => left.caseId.localeCompare(right.caseId) || left.term.localeCompare(right.term))

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
<title>Revisar extras do gabarito — rodada ${report.runId}</title>
<style>
  :root {
    --ink: #1d1c1a;
    --muted: #6b6862;
    --line: #e2ddd6;
    --bg: #faf8f5;
    --card: #fffdfa;
    --mark: #fff0b8;
    --ok: #2f6b4f;
    --warn: #8a6a1f;
    --bad: #8c3a3a;
    --alt: #38598a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    position: sticky; top: 0; z-index: 10;
    background: rgba(250,248,245,.94);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--line);
    padding: 16px 24px 12px;
  }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 19px; margin: 0 0 4px; letter-spacing: -.01em; }
  .meta { color: var(--muted); font-size: 13px; }
  .bar { display: flex; gap: 12px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
  .progress { flex: 1 1 220px; height: 8px; background: #ece7df; border-radius: 99px; overflow: hidden; }
  .progress > i { display: block; height: 100%; width: 0; background: var(--ok); transition: width .2s ease; }
  .count { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); }
  button {
    font: inherit; font-size: 13px; padding: 7px 12px;
    border: 1px solid var(--line); background: #fff; color: var(--ink);
    border-radius: 8px; cursor: pointer;
  }
  button:hover { border-color: #c9c2b8; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--alt); outline-offset: 2px; }
  button.primary { background: var(--ink); color: #fff; border-color: var(--ink); }
  main { max-width: 980px; margin: 0 auto; padding: 20px 24px 80px; }
  .intro { color: var(--muted); font-size: 14px; margin: 0 0 20px; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 18px 20px; margin-bottom: 14px;
  }
  .card.done { border-color: #cfd8d0; background: #fbfdfb; }
  .top { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .case { font-size: 12px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
  .term { font: 600 18px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
  .tag { font-size: 11px; padding: 2px 7px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted); }
  .tag.title { border-color: #d9cfae; color: var(--warn); background: #fdf8e9; }
  .sugg { margin: 10px 0 0; font-size: 13px; color: var(--muted); }
  .sugg b { color: var(--ink); font-weight: 600; }
  blockquote {
    margin: 14px 0; padding: 12px 14px; background: #f6f2ea;
    border-left: 3px solid #d8d1c4; border-radius: 0 8px 8px 0;
    font-size: 15px; white-space: pre-wrap;
  }
  mark { background: var(--mark); color: inherit; padding: 0 2px; border-radius: 3px; }
  .expected { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; color: var(--muted); }
  .chip { font: 12px ui-monospace, monospace; background: #f1ede6; border-radius: 6px; padding: 2px 7px; color: #4a463f; }
  .decide { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .decide button { min-width: 118px; }
  .decide button[aria-pressed="true"] { color: #fff; border-color: transparent; }
  .decide button[data-v="legitimo"][aria-pressed="true"] { background: var(--ok); }
  .decide button[data-v="assunto"][aria-pressed="true"] { background: var(--warn); }
  .decide button[data-v="erro"][aria-pressed="true"] { background: var(--bad); }
  .decide button[data-v="variante"][aria-pressed="true"] { background: var(--alt); }
  .decide button.hint { box-shadow: inset 0 0 0 2px rgba(56,89,138,.28); }
  .obs { margin-top: 10px; width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 13px; background: #fff; }
  .empty { color: var(--muted); font-size: 14px; }
  footer.note { margin-top: 28px; color: var(--muted); font-size: 13px; }
  @media (max-width: 560px) {
    header, main { padding-left: 14px; padding-right: 14px; }
    .term { font-size: 16px; }
  }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>Revisar os extras do gabarito</h1>
    <div class="meta">Rodada ${report.runId} · ${items.length} termos aceitos que a lista do revisor não previu</div>
    <div class="bar">
      <div class="progress" role="progressbar" aria-label="Termos revisados"><i id="fill"></i></div>
      <span class="count" id="count">0 de ${items.length}</span>
      <button id="filter">Ver só pendentes</button>
      <button class="primary" id="export">Baixar decisões (.json)</button>
      <button id="copy">Copiar JSON</button>
    </div>
  </div>
</header>
<main>
  <p class="intro">
    Cada cartão é um termo que o motor aceitou e que não estava na lista do revisor.
    A sugestão vem da auditoria do agente — confirme ou corrija. As decisões ficam
    salvas neste navegador e saem no botão de download.
    <br><strong>legítimo</strong> = entra no gabarito · <strong>assunto</strong> = é o tema da nota, não entra ·
    <strong>erro</strong> = o motor aceitou demais · <strong>variante</strong> = é o mesmo termo com outro nome.
  </p>
  <div id="list"></div>
  <footer class="note">
    A definição que o motor propôs não aparece aqui porque o relatório não a guarda — só o termo.
    Guardar o texto proposto é o próximo passo do harness.
  </footer>
</main>
<script>
const DATA = ${JSON.stringify(data).replaceAll('<', '\\u003c')};
const KEY = 'jev-extras-review-' + DATA.runId;
const VERDICTS = ['legitimo', 'assunto', 'erro', 'variante'];
const LABEL = { legitimo: 'Legítimo', assunto: 'Assunto da nota', erro: 'Erro do motor', variante: 'Variante' };
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
  const words = term.split(/\\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'));
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
    const hint = !decision.verdict && item.suggested === verdict ? ' hint' : '';
    return '<button type="button" data-act="v" data-case="' + esc(item.caseId) + '" data-term="' + esc(item.term) + '" data-v="' + verdict + '" aria-pressed="' + pressed + '" class="' + hint.trim() + '">' + LABEL[verdict] + '</button>';
  }).join('');
  return '<article class="card' + (decision.verdict ? ' done' : '') + '">'
    + '<div class="top"><span class="case">' + esc(item.caseId.replaceAll('-', ' ')) + '</span>'
    + '<span class="term">' + esc(item.term) + '</span>'
    + (item.inTitle ? '<span class="tag title">aparece no título</span>' : '')
    + (item.suggested ? '<span class="tag">sugestão: ' + LABEL[item.suggested] + '</span>' : '<span class="tag">sem sugestão</span>')
    + '</div>'
    + (item.why ? '<p class="sugg"><b>Por que:</b> ' + esc(item.why) + '</p>' : '')
    + '<blockquote>' + highlight(item.paragraph, item.term) + '</blockquote>'
    + '<div class="expected"><span>Gabarito do caso:</span>'
    + (item.expected.length ? item.expected.map((term) => '<span class="chip">' + esc(term) + '</span>').join('') : '<em>o revisor não esperava nenhum termo</em>')
    + '</div>'
    + '<div class="decide">' + buttons + '</div>'
    + '<input class="obs" data-act="obs" data-case="' + esc(item.caseId) + '" data-term="' + esc(item.term) + '" placeholder="Observação (opcional)" value="' + esc(decision.note || '') + '">'
    + '</article>';
}

document.getElementById('list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-act="v"]');
  if (!button) return;
  // Atualiza so o cartao clicado: re-renderizar a lista inteira perderia o
  // foco de quem esta navegando por teclado.
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
    if (decided) peer.classList.remove('hint');
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
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
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
      verdict: state[keyOf(item)].verdict,
      note: state[keyOf(item)].note || '',
      suggested: item.suggested,
    }));
  const summary = {};
  for (const verdict of VERDICTS) summary[verdict] = decisions.filter((entry) => entry.verdict === verdict).length;
  return { kind: 'jev-extras-review', runId: DATA.runId, reviewer: 'human', reviewedAt: new Date().toISOString(), decisions, summary };
}

document.getElementById('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'jev-extras-review-' + DATA.runId + '.json';
  link.click();
  URL.revokeObjectURL(url);
});
document.getElementById('copy').addEventListener('click', async (event) => {
  const text = JSON.stringify(payload(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    event.currentTarget.textContent = 'Copiado';
    setTimeout(() => { event.currentTarget.textContent = 'Copiar JSON'; }, 1600);
  } catch {
    window.prompt('Copie o JSON:', text);
  }
});

render();
</script>
</body>
</html>
`

writeFileSync(outPath, html, 'utf8')
console.log(`pagina em ${outPath} (${items.length} termos)`)
