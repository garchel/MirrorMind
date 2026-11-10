# Auditoria de CSS morto — candidatos

Gerado em 2026-11-10 por `node scripts/scan-dead-css.mjs --report docs/css-dead-code-report.md`.

**Isto é uma lista de candidatos, não um veredito.** O scanner é conservador:
considera vivo tudo que aparece no fonte (`.ts`/`.tsx`/`.mjs`/`.rs`/`.html`),
tudo que casa com prefixo de template (`ui-button--${size}`) e as classes
geradas por bibliotecas. O que sobra é o que **não tem nenhuma referência
literal** — pode ser código morto ou uma classe montada de um jeito que o
scanner não vê. Revisar antes de remover.

## Números

- Classes declaradas em CSS: **1200** (2573 regras com classe).
- Candidatas a mortas: **56**.
- Regras inteiramente mortas (todas as classes da regra são candidatas): **39**.
- Classes externas/geradas reconhecidas: **44**.

## Classes candidatas

| classe | regras | arquivo (1ª ocorrência) | linha |
|---|---:|---|---:|
| `editor-panel` | 11 | `src/features/editor/editor.css`, `src/features/shell/workspace-chrome.css`, `src/styles/base.css` | 2970 |
| `vault-panel` | 8 | `src/features/shell/workspace-chrome.css`, `src/styles/base.css` | 1099 |
| `markdown-tools-menu` | 6 | `src/features/editor/editor.css` | 645 |
| `markdown-tools-trigger` | 5 | `src/features/editor/editor.css` | 597 |
| `check-list` | 4 | `src/styles/base.css` | 213 |
| `editor-panel--edit` | 4 | `src/features/editor/editor.css` | 717 |
| `editor-preview` | 4 | `src/features/shell/workspace-chrome.css`, `src/styles/base.css` | 348 |
| `structural-audit-finding` | 4 | `src/features/review/review-panels.css` | 104 |
| `sub-panel` | 4 | `src/styles/base.css` | 5 |
| `vault-meta-grid` | 4 | `src/styles/base.css` | 201 |
| `vault-tag-policy-rule` | 4 | `src/features/review/vault-review-policy.css` | 169 |
| `workspace-error-status` | 4 | `src/components/PageHeader.css` | 27 |
| `editor-grid` | 3 | `src/features/shell/workspace-chrome.css`, `src/styles/base.css` | 331 |
| `editor-path` | 3 | `src/features/editor/editor.css`, `src/features/shell/workspace-chrome.css`, `src/styles/base.css` | 2963 |
| `indexadora-button` | 3 | `src/features/editor/editor.css` | 175 |
| `panel-header` | 3 | `src/styles/base.css` | 190 |
| `trash-item` | 3 | `src/features/shell/workspace-chrome.css` | 2163 |
| `trash-tree-item` | 3 | `src/features/shell/workspace-chrome.css` | 1799 |
| `tree-item-action` | 3 | `src/features/shell/workspace-chrome.css` | 1960 |
| `vault-columns` | 3 | `src/styles/base.css` | 190 |
| `vault-tag-policy-fields` | 3 | `src/features/review/vault-review-policy.css` | 186 |
| `explorer-tree-footer` | 2 | `src/features/shell/workspace-chrome.css` | 1759 |
| `frontmatter-panel-empty` | 2 | `src/features/editor/editor.css`, `src/styles/theme.css` | 2254 |
| `goal-card-header` | 2 | `src/features/goals/goals.css` | 98 |
| `graph-depth-select` | 2 | `src/components/GraphToolbar.css` | 164 |
| `graph-mode-select` | 2 | `src/components/GraphToolbar.css` | 164 |
| `markdown-tools-icon--up` | 2 | `src/features/editor/editor.css` | 633 |
| `review-ai-issue-list` | 2 | `src/features/review/review-ai.css` | 325 |
| `review-dashboard-status` | 2 | `src/features/review/review-dashboard.css` | 23 |
| `structural-audit-finding-head` | 2 | `src/features/review/review-panels.css` | 122 |
| `trash-item-list` | 2 | `src/features/shell/workspace-chrome.css` | 2150 |
| `trash-tree-content` | 2 | `src/features/shell/workspace-chrome.css` | 1785 |
| `trash-tree-summary` | 2 | `src/features/shell/workspace-chrome.css` | 1766 |
| `vault-tag-policy-rule-heading` | 2 | `src/features/review/vault-review-policy.css` | 179 |
| `bases-loading` | 1 | `src/features/bases/bases.css` | 185 |
| `explorer-refresh-icon` | 1 | `src/features/shell/workspace-chrome.css` | 2271 |
| `goal-step-actions` | 1 | `src/features/goals/goals.css` | 472 |
| `graph-controls` | 1 | `src/features/graph/graph.css` | 1148 |
| `graph-header-check` | 1 | `src/features/graph/graph.css` | 149 |
| `graph-page-header` | 1 | `src/features/graph/graph.css` | 1141 |
| `graph-search-input` | 1 | `src/components/GraphToolbar.css` | 182 |
| `markdown-preserved-raw` | 1 | `src/features/editor/editor.css` | 2871 |
| `markdown-tools-disclosure` | 1 | `src/features/editor/editor.css` | 589 |
| `markdown-tools-icon` | 1 | `src/features/editor/editor.css` | 626 |
| `markdown-tools-icon--down` | 1 | `src/features/editor/editor.css` | 637 |
| `metric-label` | 1 | `src/styles/base.css` | 36 |
| `policy-workload-estimate-sep` | 1 | `src/features/review/policy-workload-estimate.css` | 50 |
| `review-ai-dialog-backdrop` | 1 | `src/features/review/review-ai.css` | 388 |
| `structural-audit-findings` | 1 | `src/features/review/review-panels.css` | 98 |
| `tree-item-actions` | 1 | `src/features/shell/workspace-chrome.css` | 1818 |
| `vault-review-policy-heading` | 1 | `src/features/review/vault-review-policy.css` | 26 |
| `vault-tag-policy-checkbox` | 1 | `src/features/review/vault-review-policy.css` | 205 |
| `vault-tag-policy-list` | 1 | `src/features/review/vault-review-policy.css` | 164 |
| `vault-tag-policy-settings` | 1 | `src/features/review/vault-review-policy.css` | 158 |
| `workspace-note-list` | 1 | `src/styles/base.css` | 322 |
| `workspace-page-loading` | 1 | `src/features/shell/workspace-chrome.css` | 740 |

## Regras inteiramente mortas

Regras em que **toda** parte do seletor depende de classe candidata. Se a
classe não é usada, a regra não pinta nada. (Regras com uma classe viva no
meio ficam de fora de propósito.)

| arquivo | linha | seletor |
|---|---:|---|
| `src/components/PageHeader.css` | 27 | `.workspace-error-status` |
| `src/components/PageHeader.css` | 38 | `.workspace-error-status::before` |
| `src/components/PageHeader.css` | 57 | `.workspace-error-status::before` |
| `src/components/PageHeader.css` | 188 | `[data-theme='dark'] .workspace-error-status` |
| `src/features/bases/bases.css` | 185 | `.bases-loading` |
| `src/features/goals/goals.css` | 472 | `.goal-step-actions` |
| `src/features/review/policy-workload-estimate.css` | 50 | `.policy-workload-estimate-sep` |
| `src/features/review/review-ai.css` | 333 | `.review-ai-issue-list blockquote` |
| `src/features/review/review-ai.css` | 388 | `.review-ai-dialog-backdrop` |
| `src/features/review/review-dashboard.css` | 23 | `.review-dashboard-status` |
| `src/features/review/vault-review-policy.css` | 158 | `.vault-tag-policy-settings` |
| `src/features/review/vault-review-policy.css` | 164 | `.vault-tag-policy-list` |
| `src/features/review/vault-review-policy.css` | 169 | `.vault-tag-policy-rule` |
| `src/features/review/vault-review-policy.css` | 179 | `.vault-tag-policy-rule-heading` |
| `src/features/review/vault-review-policy.css` | 186 | `.vault-tag-policy-rule label, .vault-tag-policy-fields label` |
| `src/features/review/vault-review-policy.css` | 194 | `.vault-tag-policy-rule input:not([type='checkbox'])` |
| `src/features/review/vault-review-policy.css` | 205 | `.vault-tag-policy-checkbox` |
| `src/features/review/vault-review-policy.css` | 213 | `.vault-tag-policy-rule summary` |
| `src/features/review/vault-review-policy.css` | 219 | `.vault-tag-policy-fields` |
| `src/features/review/vault-review-policy.css` | 228 | `.vault-tag-policy-rule-heading, .vault-tag-policy-fields` |
| `src/features/shell/workspace-chrome.css` | 740 | `.workspace-page-loading` |
| `src/features/shell/workspace-chrome.css` | 2150 | `.trash-item-list` |
| `src/features/shell/workspace-chrome.css` | 2157 | `.trash-item-list > p` |
| `src/features/shell/workspace-chrome.css` | 2163 | `.trash-item` |
| `src/features/shell/workspace-chrome.css` | 2174 | `.trash-item:last-child` |
| `src/features/shell/workspace-chrome.css` | 2178 | `.trash-item > span` |
| `src/styles/base.css` | 184 | `.vault-panel` |
| `src/styles/base.css` | 190 | `.panel-header, .vault-columns` |
| `src/styles/base.css` | 196 | `.panel-header` |
| `src/styles/base.css` | 201 | `.vault-meta-grid` |
| `src/styles/base.css` | 207 | `.vault-meta-grid div, .sub-panel` |
| `src/styles/base.css` | 219 | `.vault-columns` |
| `src/styles/base.css` | 223 | `.sub-panel h3` |
| `src/styles/base.css` | 482 | `.editor-grid` |
| `src/styles/base.css` | 490 | `.editor-panel` |
| `src/styles/base.css` | 499 | `.editor-panel textarea, .editor-preview pre` |
| `src/styles/base.css` | 512 | `.editor-panel textarea` |
| `src/styles/base.css` | 516 | `.editor-preview pre` |
| `src/styles/base.css` | 569 | `.editor-panel textarea, .editor-preview pre` |

## Como usar

1. Confirme que a classe não é montada em runtime (procure o prefixo no fonte).
2. Remova a classe/regra em um commit pequeno, por arquivo.
3. `npm run build`, os 3 gates e `npm run test`; se algo quebrar, a classe estava viva.
4. Regenere este relatório para ver o número cair.
