<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **MirrorMind** (7652 symbols, 21071 relationships, 672 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact analysis before editing.** Use `impact({target: "symbolName", direction: "upstream"})` (MCP) or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .` (CLI fallback); report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/MirrorMind/context` | Codebase overview, check index freshness |
| `gitnexus://repo/MirrorMind/clusters` | All functional areas |
| `gitnexus://repo/MirrorMind/processes` | All execution flows |
| `gitnexus://repo/MirrorMind/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- mirror-mind:start -->
# MirrorMind — regras do repo

Esta seção é do MirrorMind e **fora** do bloco do GitNexus (que fica entre
`<!-- gitnexus:start -->` e `<!-- gitnexus:end -->`). O GitNexus reescreve
só o bloco dele; o que está aqui fora permanece.

## Git: o trabalho entra no repositório antes de existir como risco

**Regra principal: um arquivo novo entra no git no primeiro dia.**

Um arquivo que existe só no *working tree* é um arquivo que uma operação de
git pode apagar sem deixar rastro. Não há backup: o PDB guarda nomes de
símbolos, não o código, e o `git fsck` só acha o que já foi commitado.

Quando começar um arquivo novo (módulo, feature, script):

```bash
git add <arquivo> && git commit -m "wip(<escopo>): esqueleto de <nome>"
```

O commit é trivial de propósito. Ele existe para que o arquivo **esteja
versionado**; o trabalho de verdade vem nos commits seguintes, normais.

É o que salva: com o esqueleto commitado, um `git reset --hard` acidental
**devolve** o arquivo — ele está no histórico, mesmo que o commit de trabalho
seja revertido. Sem o esqueleto, o arquivo estava só no *working tree* e o
reset o apagava sem deixar rastro.

**Nunca `git reset --hard` com trabalho não commitado.** Use `git stash` ou
`git reset --soft`. O `--hard` reescreve arquivos rastreados para o estado do
commit alvo — e o que estava só no *working tree* não volta de lugar nenhum.

**Cada commit compila sozinho.** Um commit que só compila quando o seguinte
aplica é um commit quebrado: quem fizer `git bisect`, cherry-pick ou
reverter precisa de cada um funcionando. Isso vale para o Rust (cada commit
passa em `cargo check`) e para o frontend (cada commit passa em `tsc`).

**Commitar por unidade de compilação, não por caminho.** Um arquivo que
participa de dois trabalhos (o `lib.rs` do Rust registra os comandos IPC de
várias features) precisa ser dividido por *hunk*, não escondido num commit
inteiro. A verificação é: aplicar o commit sozinho, num worktree, e
compilar.

**Ler o aviso do lint antes de seguir.** O `oxlint` e o `clippy` encontraram
bugs reais que o typecheck não pega (um componente usado sem import, uma
função com nome errado). O aviso estava certo e passar por ele custou tempo.

## Medição: só o que foi medido pode virar número

Um critério **não medido** aparece como "não medido", nunca como aprovado. Vale
para o harness do JEV (a dimensão `definitions` sem ground truth é
`measured: false`, com `recall: null`) e vale para o resto do app.

Relatório que mostra `0` onde não houve medição é pior do que relatório que
mostra que não houve medição.

## Documentação: o documento descreve o que existe

Quando o estado muda (uma revisão chega, uma regra é trocada, um ground truth
é preenchido), o documento que descreve esse estado é atualizado **no mesmo
passo**. Um README que diz "nenhum caso foi revisado" enquanto todos foram é
uma mentira que faz o leitor duvidar do número — que é o oposto do que a
medição comprou.

## Chaves de API: conferir contra o servidor real

O contrato do fornecedor (a TypeSafe AI) muda. A forma do payload foi conferida
contra a API real e é esta:

- `choice.criteria` é um **mapa** nome → descrição (não lista de opções);
- `score.criteria` é uma **lista** (não mapa);
- `noul.criteria` usa os lados `true` e `false` (não `yes` e `no`).

O `serde` do `ChoiceAnswer` também é **custom** (não derivado), porque o wire
usa `criteria` como mapa e o `Deserialize` derivado não representa isso.
<!-- mirror-mind:end -->
