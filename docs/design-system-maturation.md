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

1. **73 `<button>` crus de produto sem className** (82 contando os 9 de
   teste, de 97 tags `<button>`). As 100 que tinham classe de contexto
   foram migradas — agora sao 286 `<Button>`. A premissa antiga de que
   migrar quebraria o seletor de tag estava **errada**: `<Button>`
   renderiza um `<button>` com classes a mais, entao os 83 seletores que
   ja usam `:where(button, .ui-button)` continuam casando e os 15 que
   dependem so da tag tambem. O que falta e a onda 0 de CSS e a
   migracao dos 73; ver "Por que os 73 `<button>` restantes ainda nao
   foram migrados" abaixo.

2. **112 campos crus** (93 `<input>`, 10 `<select>`, 9 `<textarea>`).
   A migracao pegou os 25 que tinham classe; o resto herdava o reset
   global de `base.css`. Migrar exigiria decidir o visual de cada um —
   hoje nao ha um "campo" no app, ha tres tags com aparencia que
   depende de onde aparecem.

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

### Por que os 73 `<button>` restantes ainda nao foram migrados (medido em 2026-10-30)

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
   `docs/button-migration-review.html`; depois os 14 que ja tem classe
   dinamica, preservando a classe.

A medicao que sustenta os numeros: `scan-buttons.mjs` (97 tags, 82 sem
classe, 73 de produto), `scan-tag-rules.mjs` (98 seletores, 83 com
`.ui-button`, 15 so tag), `scan-button-props.mjs` (286 `<Button>`, 153
com classe manual) e `scan-context-rules.mjs` (16 regras com `display`
sem `justify-content`). Os quatro rodam sobre `src/`, sem dependencia
nova.
