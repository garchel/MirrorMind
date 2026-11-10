# Auditoria de CSS morto — candidatos

Gerado em 2026-11-10 por `node scripts/scan-dead-css.mjs --report docs/css-dead-code-report.md`.

**Isto é uma lista de candidatos, não um veredito.** O scanner é conservador:
considera vivo tudo que aparece no fonte (`.ts`/`.tsx`/`.mjs`/`.rs`/`.html`),
tudo que casa com prefixo de template (`ui-button--${size}`) e as classes
geradas por bibliotecas. O que sobra é o que **não tem nenhuma referência
literal** — pode ser código morto ou uma classe montada de um jeito que o
scanner não vê. Revisar antes de remover.

## Números

- Classes declaradas em CSS: **1186** (2534 regras com classe).
- Candidatas a mortas: **42**.
- Regras inteiramente mortas (todas as classes da regra são candidatas): **0**.
- Classes externas/geradas reconhecidas: **44**.

## Classes candidatas

| classe | regras | arquivo (1ª ocorrência) | linha |
|---|---:|---|---:|
| `editor-panel` | 7 | `src/features/editor/editor.css`, `src/features/shell/workspace-chrome.css` | 2972 |
| `vault-panel` | 7 | `src/features/shell/workspace-chrome.css`, `src/styles/base.css` | 1093 |
| `markdown-tools-menu` | 6 | `src/features/editor/editor.css` | 647 |
| `markdown-tools-trigger` | 5 | `src/features/editor/editor.css` | 599 |
| `check-list` | 4 | `src/styles/base.css` | 186 |
| `editor-panel--edit` | 4 | `src/features/editor/editor.css` | 719 |
| `structural-audit-finding` | 4 | `src/features/review/review-panels.css` | 106 |
| `editor-path` | 3 | `src/features/editor/editor.css`, `src/features/shell/workspace-chrome.css`, `src/styles/base.css` | 2965 |
| `indexadora-button` | 3 | `src/features/editor/editor.css` | 177 |
| `trash-tree-item` | 3 | `src/features/shell/workspace-chrome.css` | 1793 |
| `tree-item-action` | 3 | `src/features/shell/workspace-chrome.css` | 1954 |
| `editor-grid` | 2 | `src/features/shell/workspace-chrome.css`, `src/styles/base.css` | 333 |
| `explorer-tree-footer` | 2 | `src/features/shell/workspace-chrome.css` | 1753 |
| `frontmatter-panel-empty` | 2 | `src/features/editor/editor.css`, `src/styles/theme.css` | 2256 |
| `goal-card-header` | 2 | `src/features/goals/goals.css` | 100 |
| `graph-depth-select` | 2 | `src/components/GraphToolbar.css` | 168 |
| `graph-mode-select` | 2 | `src/components/GraphToolbar.css` | 168 |
| `markdown-tools-icon--up` | 2 | `src/features/editor/editor.css` | 635 |
| `structural-audit-finding-head` | 2 | `src/features/review/review-panels.css` | 124 |
| `sub-panel` | 2 | `src/styles/base.css` | 7 |
| `trash-tree-content` | 2 | `src/features/shell/workspace-chrome.css` | 1779 |
| `trash-tree-summary` | 2 | `src/features/shell/workspace-chrome.css` | 1760 |
| `vault-meta-grid` | 2 | `src/styles/base.css` | 186 |
| `editor-preview` | 1 | `src/features/shell/workspace-chrome.css` | 350 |
| `explorer-refresh-icon` | 1 | `src/features/shell/workspace-chrome.css` | 2231 |
| `graph-controls` | 1 | `src/features/graph/graph.css` | 1150 |
| `graph-header-check` | 1 | `src/features/graph/graph.css` | 150 |
| `graph-page-header` | 1 | `src/features/graph/graph.css` | 1142 |
| `graph-search-input` | 1 | `src/components/GraphToolbar.css` | 184 |
| `markdown-preserved-raw` | 1 | `src/features/editor/editor.css` | 2873 |
| `markdown-tools-disclosure` | 1 | `src/features/editor/editor.css` | 591 |
| `markdown-tools-icon` | 1 | `src/features/editor/editor.css` | 628 |
| `markdown-tools-icon--down` | 1 | `src/features/editor/editor.css` | 639 |
| `metric-label` | 1 | `src/styles/base.css` | 38 |
| `panel-header` | 1 | `src/styles/base.css` | 470 |
| `review-ai-issue-list` | 1 | `src/features/review/review-ai.css` | 327 |
| `review-dashboard-status` | 1 | `src/features/review/review-dashboard.css` | 25 |
| `structural-audit-findings` | 1 | `src/features/review/review-panels.css` | 100 |
| `tree-item-actions` | 1 | `src/features/shell/workspace-chrome.css` | 1812 |
| `vault-columns` | 1 | `src/styles/base.css` | 470 |
| `vault-review-policy-heading` | 1 | `src/features/review/vault-review-policy.css` | 28 |
| `workspace-note-list` | 1 | `src/styles/base.css` | 287 |

## Regras inteiramente mortas

Regras em que **toda** parte do seletor depende de classe candidata. Se a
classe não é usada, a regra não pinta nada. (Regras com uma classe viva no
meio ficam de fora de propósito.)

| arquivo | linha | seletor |
|---|---:|---|

## Como usar

1. Confirme que a classe não é montada em runtime (procure o prefixo no fonte).
2. Remova a classe/regra em um commit pequeno, por arquivo.
3. `npm run build`, os 3 gates e `npm run test`; se algo quebrar, a classe estava viva.
4. Regenere este relatório para ver o número cair.
