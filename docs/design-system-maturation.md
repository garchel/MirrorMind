# Design system — amadurecimento da camada 1

Estado: branch `staging`, medicao de botoes refeita em 2026-10-30. A
estrutura das 3 camadas + os 4 gates esta pronta; o que falta e
**maturidade**. A revisao visual da onda de botoes esta em
`docs/button-migration-review.html` (previews com o CSS real do app).

## Progresso

**456 → 278 primitivas (-39%)** e **29 → 10 papeis tipograficos**.
Sete familias de cor consolidadas e a escala tipografica aplicada, cada
uma em commit proprio, com os gates medindo o drift em vez de eu
afirmar que nao houve:

| familia | antes | depois | commit |
|---|---|---|---|
| `gold` | 53 | 15 | `6feb547` |
| `lilac` | 23 | 14 | `696499b` |
| `sage` | 40 | 31 | `b155a42` |
| `moss` | 17 | 12 | `b155a42` |
| `brick` | 39 | 35 | `b155a42` |
| `ink` | 161 | 75 | `d272497` |
| `clay` | 90 | 63 | `8f6fd78` |
| tipografia | 29 literais | 10 papeis | `404f35c` |

Restam 17 tokens de ganho possivel em cor (6,1%) — abaixo do limiar que
vale a risco de mover pixel. `sage`, `lilac` e `teal` estao esgotados.

**Drift acumulado:** 569 referencias, DeltaE max **2,29** — todas abaixo
do piso perceptual de 2,3. Os gates estritos continuam **falhando**, como
devem: a consolidacao move pixel, e isso precisa ficar visivel.

**Auditoria de contraste:** os 185 pares cor/fundo reais do app foram
medidos antes e depois de cada familia. Zero quebras de AA. Um par
melhorou (4,46 → 4,51). Maior variacao: 0,577 de razao.

**Escala tipografica:** 224 tamanhos convertidos em 33 arquivos, com
`small = 13px` e `caption = 12px` decididos pelo usuario. 22px e 28px
ficaram literais de proposito (+2/+4px em titulo de largura variavel
aperta a linha, e nenhum gate mede layout). Verificacao visual via
Playwright: os tokens resolvem no valor decidido e nao ha overflow nem
texto cortado. Gate: `npm run tokens:verify:type`, que casa 534
tamanhos token a token contra o baseline. Adicoes e remocoes de
declaracao sao registradas com posicao, valor e motivo (`ADICIONADOS` /
`REMOVIDOS` no script): o gate nao aceita nem uma nem outra sem prova.

## Pendencias conhecidas

Medido em `camada3-primitivos` (2026-09-29), com os numeros de botao
refeitos em 2026-10-30; nada aqui e estimativa.

### A camada 3 esta pela metade, e isso e um numero

| primitivo | uso real | tokens que le |
|---|---:|---|
| `<Button>` | 286 | `--button-*` |
| `<Field>` | 22 | `--field-*` |
| `<Card>` | 2 | `--card-*` |
| `<Badge>` | 1 | `--chip-*` |

`<Button>` remedido em 2026-10-30 (286 tags `<Button>` em `src/**/*.tsx`);
os outros tres sao da medicao de 2026-09-29 e nao foram remedidos.

Tokens de componente consumidos: **19 -> 77 referencias** (medido em
2026-09-29). Dos 68 tokens de componente definidos, **49 tinham
consumidor e 19 eram orfaos**. Os 19 orfaos foram removidos depois:
`--button-height*`, `--button-padding-x*`, `--button-font`, `--notice-*`,
`--tab-*` e `--panel-border-radius`/`--panel-inset-radius`. Em
2026-10-30 so restam os comentarios que registram a remocao em
`src/styles/tokens/component.css`; nenhum token orfao desses grupos
continua definido.

### O que falta, em ordem de tamanho

1. **Nenhum `<button>` cru de produto resta** — o inventario de
   2026-10-30 era 73 sem classe + 14 com classe = 87, mais a onda
   de 100 com classe de contexto, e a onda 1 migrou tudo em 14 grupos
   medidos (o scan exibe 0). As 286+ `<Button>` agora sao a unica fonte.
   A premissa antiga de que migrar quebraria o seletor de tag estava
   **errada**: `<Button>` renderiza um `<button>` com classes a mais,
   entao os 83 seletores que ja usam `:where(button, .ui-button)`
   continuam casando e os 15 que dependem so da tag tambem. O que ficou
   medido, grupo a grupo, esta na tabela e no preview. Falta a onda dos
   campos crus e das alturas (abaixo).

2. **111 campos crus** (medido por `node scripts/scan-fields.mjs` em
   2026-11-10: 96 `<input>`, 10 `<textarea>`, 5 `<select>`, em 25
   arquivos). O scanner ignora comentários — a primeira versão dele
   contava 3 comentários como campo (114 era ruído); o "112 campos
   (93/10/9)" do doc antigo era estimativa, não medição. Do total,
   **77 migram** para `<Field>` (a família textual: 62 inputs de
   texto/search/password/number/date/email mais 10 textarea e 5
   select) e **34 não migram** — 19 checkbox, 11 radio e 4 color: o
   `<Field>` é campo de texto, e o glifo desses tipos precisa de
   decisão própria; vira item separado, fora desta onda. Dos crus,
   108 não tinham classe (herdavam o reset de `base.css`) e 3 tinham
   classe estática de visual próprio completo (`frontmatter-panel-key/
   value`, `postit-popover-input` — fora da onda). A onda migra por
   lote medido (o mesmo processo dos botões): lote 1 fechou os 6
   atalhos de `SettingsPage` (38px do contexto preservado) e lote 2
   fechou os 18 do grafo (header 30px, números do popover 26px fixos
   — o contexto precisou declarar `min-height` porque o `height` fixo
   perde para o `min-height: 48px` do primitivo —, exportação 28px,
   busca do filtro embutida) e lote 3 fechou os 8 da página de tags
   (busca 36px, nome 40px com padding UA preservado, ritmo 38px fixo
   que também precisou de `min-height`, e um `:focus-visible` comum
   para o primitivo não injetar anel onde o cru não tinha) e lote 4
   fechou os 5 números das opções avançadas da política do Vault (base
   idêntica em 41px; os dois estados de interação mudam por decisão,
   porque o contexto não tinha foco nem hover — o anel UA `auto 1px`
   vira `2px` accent e a borda escurece no hover) e lote 5 fechou os 4
   campos da revisão com IA (chave do Gemini, endereço, modelo e chave
   OpenAI-compatible; base idêntica em 43px, mesmos estados de
   interação decididos do lote 4) e lote 6 fechou os 3 da criação de
   meta (título 38px e os dois textareas 88px mono; o foco já era do
   contexto e o hover precisou de regra própria para não trocar a
   borda quente pelo token de tinta) e lote 7 fechou os 3 do
   dicionário (busca embutida na pílula, 29px com `min-height: 0` e
   padding UA preservado; formulário 45px e textarea 126px; o
   placeholder passa ao token `--field-placeholder` por decisão, e o
   hover escurece a borda na mesma matiz) e lote 8 fechou os 3 textareas
   da sessão de revisão (síntese 322,88px, resposta 199,5px e diagnóstico
   177,81px no harness; o foco da resposta já era do contexto e precisou
   de `outline-offset: 0` para o offset do primitivo não vazar; nas
   outras duas o anel vira o accent 2px, e o hover dos três foi
   preservado por regra de contexto) e lote 9 fechou os 10 do `App.tsx`
   (8 barras de modal idênticas em 48px, com `border-radius: 0` e o
   foco preservados no contexto; filtro de tags 18px com `min-height: 0`;
   e o caminho recuperado, que era input UA e adota `size="sm"` por
   transição decidida) e lote 10 fechou a busca das Bases (campo 18px com
   `min-height: 0`, pílula de 30px idêntica e o foco preservado no
   contexto, com o anel na pílula) e lote 11 fechou a busca na nota
   (barra de 30,19px e campo de 20,19px idênticos, com o anel global
   de foco preservado). Restam 49 crus,
   todos fora do escopo ou nos próximos lotes; ver
   `docs/field-migration-review.html`.

3. **15 alturas de botao distintas** no CSS do app (14, 18, 20, 22,
   24, 26, 28, 30, 34, 36, 37, 40px), e o `size` do `<Button>` cobre
   3 (`xs`/`sm`/`md`). A escala foi medida para os 3 grupos mais
   frequentes (glifo/compacto/padrao); o resto e ajuste de contexto
   que fica no `className`. Reduzir isso exige decisao de design sobre
   quantas densidades o app deve ter — nao e refatoracao.

4. ~~**19 tokens orfaos**~~ ✅ removidos. Os tres grupos eram botao
   (`--button-height*`, `--button-padding-x*`, `--button-font`), aviso
   (`--notice-*`), tab (`--tab-*`) e painel
   (`--panel-border-radius`/`--panel-inset-radius`). Em 2026-10-30 so
   restam os comentarios de remocao em `component.css`; nenhum deles
   continua definido.

### Fora do escopo (pre-existente)

5. **Rust/coverage na CI falha na `main` tambem** (verificado em
   `bca78d8` e `1cb754b`, anteriores ao design system):
   `Missing coverage report: coverage/rust/lcov.info` e falha em
   `cargo test`. Nao e regressao. No job Windows, `Frontend tests`
   estava falhando por outra causa — stderr tratado como erro pelo
   PowerShell — e isso **foi corrigido** (`d061c61`): agora o JUnit e
   a autoridade. `Windows required` passa em `Frontend tests`,
   `Design system gates`, `Lint`, `Typecheck` e `Frontend build`.

## Concluido nesta rodada

- **Contraste AA** (`b44001e`): `--text-muted`, `--faint` e
  `--text-subtle` passam 4,5:1 no claro (6,43 / 6,05 / 5,59; eram
  4,43 / 4,17 / 2,01). Tokens novos `--mm-ink-aa-*` em vez de
  sobrescrever `--mm-ink-850`, que e cor de borda em 15 regras do editor.
- **380 referencias migradas** (`437e04c`): os alias `--review-*` sairam
  do app, e a camada 2 finalmente e consumida em vez de existir sem uso.
- **`verify-tokenization` reescrito**: casava por posicao (falso positivo
  em 3 pontos) e depois por similaridade gulosa (DeltaE 14 inexistente).
  Agora compara o hex de cada token contra o conjunto de hex do baseline.
- **Tokens semanticos na Revisao** (`2026-11-06`): os 13 usos de
  `--mm-*` sem primitiva em `review-ai.css` passaram a apontar para os
  slots semanticos (`--border`, `--status-*`, `--text`, `--accent`).
  `verify-tokenization` volta a 0 orfaos.
- **Aviso Rust que quebrava a cobertura** (`2026-11-06`): a variavel
  `ai_quote2`, declarada e nao usada no teste de citacao tolerante, era
  erro sob `-D warnings` (o `setup-rust-toolchain` da CI aplica esse
  flag). Removida; `cargo check --tests --all-features` com
  `RUSTFLAGS=-D warnings` passa.

## O defeito original (para referencia)

A camada 1 tem **456 primitivas**, geradas 1:1 dos hex em uso. Isso
funciona e nao move pixel nenhum, mas nao e uma rampa — e um dump do
estado atual com nomes automaticos:

- **68 steps** carregar mais de uma cor (quando um step deveria ter uma).
  O pior tem **33 hex** disputando o mesmo step.
- **93 violacoes** da ordem de luminancia que o nome promete: ler
  `--mm-ink-850` → `--mm-ink-850-2` nao vai do claro ao escuro.
- **347 tokens (76%)** carregam sufixo de colisao. Quando o sufixo e
  necessario, o step parou de ser informacao.

Referencia: um sistema maduro tem 40–80 primitivas. Radix Colors, que e
o teto pratico do setor, tem 14 rampas × 12 degraus = 168.

## A medicao

`scripts/cluster-primitives.py` agrupa por **DeltaE76 em CIELAB** (nao
por distancia de hex em RGB — RGB nao e perceptual e mentiria). O
criterio de corte e **2.3**, o piso de "mesma cor" da literatura de
identidade de cor: abaixo disso duas cores sao indistinguiveis lado a
lado em texto pequeno.

| DeltaE de corte | 456 viram | reducao |
|---|---|---|
| 1.0 (ultra-conservador) | 364 | 20% |
| **2.3 (piso perceptual)** | **277** | **39%** |
| 4.0 (agressivo, visivel) | 217 | 52% |

Por familia, no corte 2.3:

| familia | atual | rampa | economia | pior ΔE do grupo |
|---|---|---|---|---|
| gold | 53 | 15 | **-71,7%** | 2,25 |
| ink | 161 | 75 | -53,4% | 2,29 |
| lilac | 23 | 14 | -39,1% | 2,17 |
| clay | 90 | 63 | -30,0% | 2,23 |
| moss | 17 | 12 | -29,4% | 2,04 |
| sage | 40 | 31 | -22,5% | 1,94 |
| brick | 39 | 35 | -10,3% | 2,06 |
| azure | 27 | 26 | -3,7% | 1,93 |
| teal / rose | 6 | 6 | 0% | — |

**O pior caso de toda a consolidacao e 2,29 de DeltaE** — abaixo do piso.
Ou seja: nenhum pixel muda de forma perceptivel. Isso e por construcao
(o corte e o criterio), nao por sorte.

Exemplo do que some: `gold` tem 13hex de papel quase identicos
(`#eeece6` … `#f4f2eb`, ΔE 2,13 entre os extremos) e 8 do mesmo
grupo. Sao 53 tokens representing 15 papeis de verdade.

### O que a consolidacao **nao** resolve

`ink` sozinho tem 161 cores porque o app e denso (editor + grafo +
revisao ao mesmo tempo), nao porque a paleta esteja errada. Consolidar
`ink` economiza nomes, **nao** muda o produto. `gold` economiza 38
tokens que nunca foram distinguiveis — ai sim e ganho real.

Por isso a proposta **nao e "compacte tudo"**: e colapsar so onde a
duplicidade e visualmente demonstrada, e deixar `ink`/`clay` com
degraus folgados onde a distincao existe de fato.

## Ordem proposta

Cada passo e um commit, com os 4 gates verdes e uma tabela
antes/depois.

1. **`gold` e `lilac`** — duplicidade maxima (71,7% e 39,1%), risco
   perceptual zero. Sao superficies de fundo: se algo mudar, aparece
   como um retangulo de papel, facil de ver em screenshot.
2. **`brick`, `moss`, `sage`** — familia de status. DeltaE max 2,06.
3. **`ink`** — so os grupos com >= 3 hex realmente proximos. Cuidado
   especial: `ink` alimenta texto, e texto e onde a 1–2 de luminancia
   vira 2–3 de razao de contraste.
4. **`clay`, `azure`** — baixa economia (30% e 3,7%), ganho pequeno
   para o risco em cor de acao. Ultimo.
5. **Tipografia — feita.** 29 literais viraram 10 papeis
   (`404f35c`), com `small = 13px` e `caption = 12px` decididos.
6. **Camada 3 — ondas 1 e 2 feitas.** `<Button>` criado e 286 usos
   (medido em 2026-10-30). Faltam `<Input>`, `<Card>` e `<Chip>`, que
   tem token mas nenhum primitivo os usa.

## Regra de decisao

Consolidacao **move pixels**, mesmo que imperceptivelmente. Por isso
cada familia so e aplicada depois de:

1. `cluster-primitives.py` mostrar o agrupamento (ja roda, so agrupa);
2. a tabela antes/depois ser revisada por olho humano;
3. os 4 gates passarem **e** o `verify-tokenization` continuar em zero
   divergencia para o que nao foi tocado.

Se um passo falhar o terceiro ponto, o hex volta. O ganho de 39% nao
vale um pixel de texto pior.

### O `<button>` do `RootErrorBoundary` (lote 14)

A camada 3 fechou em **49 tokens de componente, zero orfaos**. O que
falta e adocao. A premissa antiga — "se `<button>` virar `<Button>`, o
elemento deixa de casar com o seletor de tag" — esta **errada** e foi
medida contra o CSS real:

- `<Button>` renderiza um `<button>` (`src/components/ui/Button.tsx:92`)
  com classes a mais. O elemento continua sendo `button`.
- Dos **98 itens de seletor** que citam a tag, **83 ja usam
  `:where(button, .ui-button)`** e continuam casando. Os **15 que
  dependem so da tag** tambem casam, porque o elemento e o mesmo.
- Nao ha, portanto, "58 regras para reescrever". Ha **9 seletores de
  contexto** que merecem virar `:where` por consistencia (foco e
  contexto), e uma preparacao de **onda 0** de duas linhas por contexto.

O inventario de 2026-10-30 era **73 crus sem classe + 14 com classe = 87**
de produto. A onda 1 migrou os 90 deles (73 sem classe + 17 com classe,
contando o do boundary)
em 14 grupos do preview. **Nenhum cru resta** (o scan exibe 0; a unica
contagem interna e o `<button>` do proprio `Button.tsx`).

O que **de fato** muda o pixel ao migrar, medido no navegador com o CSS
real (previews em `docs/button-migration-review.html`):

| armadilha | mecanismo | correcao |
|---|---|---|
| `size="xs"` em botao com texto | `.ui-button--xs:not(:has(.ui-button__icon + :not(:empty)))` tem especificidade **0,3,0** (o `:not(:empty)` conta como classe) e zera o padding; texto puro nao conta como elemento | usar `size="sm"` em linha com texto; `xs` so para glifo |
| fonte 15px vira 12px | contexto nao declara `font-size`; a classe de tamanho injeta 12px | `font-size: inherit` no contexto (6 contextos) |
| conteudo centraliza | `.ui-button` injeta `justify-content: center`; contexto nao reseta | `justify-content: normal` no contexto (9 contextos) |
| 46px vira 34/40px | o botao cru herda `button { min-height: 46px }` do `base.css`; a classe de tamanho vence | correcao intencional: alinha com os `<Button>` da mesma barra |

A correcao da fonte e `font-size: inherit`, **nao** `font: inherit`. O
`base.css` aplica `font: inherit` e depois `font-weight: 600`; repetir o
shorthand no contexto tambem zera o peso (medido no navegador: 600 vira
400). O `font-size` herdado neutraliza so o 12px injetado e preserva o
peso do botao cru. A medicao tambem mostrou que o `command-palette-results`
precisa da mesma linha: sao **6** contextos, nao 5.

O gate `scripts/verify-button-cascade.py` tambem exige `:where` nas duas
regras de foco generico (`Modal.css` e `goals.css`). Elas foram migradas
por consistencia na mesma onda; o elemento continua sendo `button`, entao
o foco do botao cru nao muda.

O `justify-content: normal` e o valor inicial (stretch no grid,
flex-start no flex): e no-op para o botao cru e neutraliza o `center`
injetado. `start` tambem neutraliza, mas encolhe a faixa do grid para
`max-content` e muda a quebra de linha — ou seja, cria a regressao que a
onda 0 existe para evitar.

O caminho continua em dois passos, mas o passo 1 e menor do que o doc
antigo dizia:

1. **onda 0** — 9 seletores de contexto para `:where(button, .ui-button)`,
   9 contextos de linha/menu com `justify-content: normal`, 6 com
   `font-size: inherit`. Um commit so, sem migrar `.tsx`; nenhuma mudanca
   visual (medido: os 6 previews ficam identicos, exceto modal/vault, que
   encurtam de proposito).
2. **onda 1** — os 73 crus de produto viram `<Button variant size>`,
   com a variante declarada em cada grupo de
   `docs/button-migration-review.html`; depois os que ja tem classe
   dinamica, preservando a classe.

   Progresso da onda 1 (medido, nao estimado):

   | lote | arquivo | botoes | alvo | estado |
   |---|---|---|---|---|
   | 1 | `FormatToolbar.tsx` | 16 | `bare` / `xs` | migrado |
   | 2 | `EditorContent.tsx` | 21 | `bare` / `xs` | migrado |
   | 3 | `App.tsx` (linhas de lista) | 5 | `bare` / `sm` | migrado |
   | 4 | `ExplorerSidebar.tsx` (menu) | 5 | `bare` / `sm` | migrado |
   | 5 | `App.tsx` (acoes de modal) | 7 | `primary` / `sm` | migrado |
   | 6 | `VaultSelection.tsx` | 3 | `primary` / `md` (2) + `sm` (1) | migrado |
   | 7 | `EditorHeader.tsx` (lacunas) | 3 | `bare` / `xs` | migrado |
   | 8 | `GraphToolbar.tsx` (2D/3D) | 2 | `bare` / `sm` | migrado |
   | 9 | `SettingsPage.tsx` | 4 | `bare` / `sm` | migrado |
   | 10 | `App.tsx` (mover) + `NoteReviewPolicyControl.tsx` (presets) | 4 | `bare` / `sm` | migrado |
   | 11 | primárias de review/settings (6 arquivos) | 9 | `primary` / `sm` | migrado |
   | 12 | tags (`TagManagementPage`, `NoteTagPicker`, `NoteTagRow`) | 5 | `bare`/`primary` / `sm` | migrado |
   | 13 | `ObsidianPdfEmbed`, `ExplorerSidebar`, `DictionarySearchToast` | 5 | `bare` / `sm`+`xs` | migrado |
   | 14 | `RootErrorBoundary` (1 cru final) | 1 | `bare` / `sm` + classe | migrado |

   O lote 1 foi medido no preview com o CSS real: o retangulo continua
   28×28, com o mesmo fundo, cor, raio e peso 600; so a fonte (15px → 12px)
   e o `justify-content` mudam, e o grupo e so glifo, entao nao ha mudanca
   visual. O lote 2 tambem ficou identico (26×26), mas precisou de uma
   linha de CSS: o glifo `xs` do primitivo e um quadrado de 28px com
   especificidade 0,3,0, e a barra flutuante e mais densa (26px). A regra
   de contexto tem 0,2,0 e perdia no `min-width`; a classe de tamanho entra
   no seletor para empatar em 0,3,0 e vencer por ordem. O lote 3 foi medido
   do mesmo jeito: a busca de notas (132,5px) e as sugestoes de tag (25px)
   ficaram identicas, e a paleta de comandos encurtou de 46 para 34px de
   proposito — o botao cru herdava o pill de 46px do `base.css`, e o `sm`
   alinha a linha com o resto do modal. O lote 4 ficou em 30px de altura,
   com padding `0 8px`, fonte, peso e alinhamento identicos; a
   largura varia 1px de subpixel (282,5 contra 283,5), como a medicao
   original ja registrava. O lote 5 alinha o confirmar de cada modal ao
   "Cancelar" que ja era `<Button>`: 46 para 34px, padding 18 para 14px e
   fonte 15 para 12px. O lote 6 mediu uma excecao ao plano: as duas acoes
   de cartao viram `primary md` (46 para 40px, padding 18 para 16px, fonte
   15 para 14px), mas o "Usar este vault" do modal fica `primary sm`. O
   rodape e flex com `align-items: stretch`: o `md` faria o "Escolher outro
   vault" (que ja era `secondary sm`, 34px) esticar para 40px. Com `sm` os
   dois ficam em 34px e o botao ja migrado nao muda. O lote 7 media um caso
   em que o CSS ja declarava 26px mas o reset global de `min-height: 46px`
   do `base.css` vencia: os tres botoes crus mediam 46px. Com `bare xs`
   fica em 26px (46 → 26), com padding `0 10px`, fonte 12px, peso 600, raio
   e cores identicos. O `xs` do primitivo tem `min-height: 28px`; a regra
   de contexto (`editor.css:1766`) repete a classe de tamanho para vencer
   esse minimo e manter os 26px declarados. O lote 8 (2D/3D do grafo)
   ficou identico: 27px de altura, padding `0 11px`, fonte 12px, peso 600,
   raio, fundo ativo e sombra iguais, sem linha de CSS nova — nele o
   `xs` nao serve, porque a regra do glifo zera o padding do botao de
   texto, e o `sm` respeita o `0 11px` do contexto. O lote 9 (nav e
   segmentados das configuracoes) tem metade de cada caso: o botao da
   `settings-nav` ficou identico (36px, padding `0 11px`, fonte 13px,
   peso 500/600 ativo, gap 9px, raio, cores e sombra inset iguais,
   porque a regra de contexto tem especificidade 0,4,0 e cobre tudo o
   que o primitivo injeta); os segmentados medem uma correcao
   intencional — o cru herdava `min-height: 46px` e
   `border-radius: 999px` do reset (o contexto nao declara raio nem
   altura), e o ativo aparecia como pill: com `sm` mede 46 para 34px,
   pill 999 para raio 8px, texto topo para centrado; padding `8px 14px`
   e fonte 13px preservados. O lote 10 fecha os 2 grupos de classe
   dinamica: os destinos de mover (`workspace-chrome.css:2062` · 32px)
   e os presets de ritmo (`review-policy.css:129` · grid, `padding: 11px`)
   ficaram identicos por pixel — nos presets o conteudo de duas linhas
   (71px) vence o `min-height`, entao os 46px do reset ja eram inertes.
   O lote 11 migra as 9 primarias de review/settings (`primary sm`,
   como o lote 5): o cru herdava do reset pill de 46px com fonte 15px
   (no dashboard o contexto ja impunha 34px, e sobrava so o raio
   999px); descoberta da medicao — com rotulos longos o cru quebra em
   duas linhas e mede 54px, o `sm` volta a 1 linha em 34px de fonte
   12px (dashboard, 13px preservada). `AccountSettings` mantem
   `type="submit"` explicito. O lote 12 (tags) mantem a familia: menu do
   picker 46-34px (`padding 7px 8px` intacto), linha do frontmatter
   46-37px (o conteudo de 27px vence o minimo), impacto da tag pill
   999-8px, e na pagina de tags o contexto de 0,3,1 re-declara tudo e
   so o padding 18-14px muda. O lote 13 fecha os mediveis: PDF e
   sugericoes do filtro identicos por pixel (o contexto vence tudo; nas
   fixadas so o padding 18-14px), e o close do toast de dicionario
   migra como `bare xs` com a regra de contexto repetindo o quadrado
   24x24 (dictionary.css, padrao do lote 7) - o glifo `xs` do
   primitivo despejaria 28px. O lote 14 fecha o inventario: o botao do
   `RootErrorBoundary` (a tela de emergencia inline) passa por `<Button
   bare sm>` com a geometria real declarada em `RootErrorBoundary.css`
   (qualificada pelo contêiner — 0,2,0 vence `bare`/`sm` por ordem).
   Medicao: o inline hoje mede 46px (o min-height do reset vencia o
   proprio botao) — preservado com `min-height: 46px` declarado, e o
   antes/depois e identico por pixel (46px, `8px 18px`, sage, branco,
   14px/600, raio 6).

A medicao que sustenta os numeros, hoje, tem duas partes reproduziveis:

- `node scripts/scan-buttons.mjs` conta os `<button>` crus de produto
  (fora de teste e do proprio primitivo). Nesta data: **0** — o
  inventario fechou no lote 14 (o ultimo cru era o do
  `RootErrorBoundary`).
- `node scripts/scan-fields.mjs` conta os campos crus
  (`<input>/<select>/<textarea>`) de produto, o mesmo padrão do scanner
  de botões (ignora comentários). Nesta data: **49** crus — após os
  lotes 1–11 da onda de campos (inventário inicial medido: 111).
- `py -3 scripts/verify-button-cascade.py` confere que nenhuma regra de
  contexto ainda depende so da tag `button` (37 arquivos `.css`).

Os outros numeros desta secao — **98 itens de seletor, 83 com
`.ui-button`, 15 so tag**, **286 `<Button>`, 153 com classe manual** e
**16 regras com `display` sem `justify-content`** — vieram de uma
medicao pontual em 2026-10-30. Os scripts que os geraram
(`scan-tag-rules.mjs`, `scan-button-props.mjs`,
`scan-context-rules.mjs`) nao existem no repo; por isso eles ficam aqui
como historico, nao como comando que se possa rodar. Recriar os tres e
trabalho pendente, nao um numero medido.
