# Design system — amadurecimento da camada 1

Estado: branch `design-system-maturation`, apos `93a8a75` (as 3 camadas
+ os 4 gates). A estrutura esta pronta; o que falta e **maturidade**.

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
texto cortado. Gate: `npm run tokens:verify:type`, que casa 536
tamanhos token a token contra o baseline.

## Pendencias conhecidas

Medido em `camada3-primitivos` (2026-09-29), nao estimado.

### A camada 3 esta pela metade, e isso e um numero

| primitivo | uso real | tokens que le |
|---|---:|---|
| `<Button>` | 152 | `--button-*` |
| `<Field>` | 22 | `--field-*` |
| `<Card>` | 2 | `--card-*` |
| `<Badge>` | 1 | `--chip-*` |

Tokens de componente consumidos: **19 -> 77 referencias**. Dos 68
tokens de componente definidos, **49 tem consumidor e 19 sao orfaos**.

### O que falta, em ordem de tamanho

1. **183 `<button>` crus** em 39 arquivos. A migracao parou nos que
   usavam `secondary/primary/danger-button` (150 de 184). Os 183
   restantes sao de outros padroes: `.tab-close`, `.sk-chip-row`,
   `.goal-card-hit` (auto-fechado, e um overlay), controles de toolbar.

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

4. **19 tokens orfaos** em tres grupos:
   - botao (5): `--button-height`, `--button-height-sm`,
     `--button-padding-x`, `--button-padding-x-sm`, `--button-font`.
     Declarados como 46px e 32px, que **nao batem com nenhuma altura
     real** do app. Estao orfaos porque o `.ui-button` hardcodes a
     geometria em `--button-size-{xs,sm,md}-*`. Sao tokens que
     contradizem a medicao: devem ser removidos ou corrigidos.
   - aviso (5): `--notice-*`. O app tem `.error-banner` e
     `.special-files-limit-notice`, que nao leem nenhum token.
   - tab (9): `--tab-*`. O app tem `.tab-strip`, `.tab-chip`,
     `.tab-select`, `.tab-close`, todos com CSS proprio.
   - panel (2): `--panel-border-radius`, `--panel-inset-radius`.

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
6. **Camada 3 — ondas 1 e 2 feitas.** `<Button>` criado e 150 botoes
   migrados. Faltam `<Input>`, `<Card>` e `<Chip>`, que tem token mas
   nenhum primitivo os usa.

## Regra de decisao

Consolidacao **move pixels**, mesmo que imperceptivelmente. Por isso
cada familia so e aplicada depois de:

1. `cluster-primitives.py` mostrar o agrupamento (ja roda, so agrupa);
2. a tabela antes/depois ser revisada por olho humano;
3. os 4 gates passarem **e** o `verify-tokenization` continuar em zero
   divergencia para o que nao foi tocado.

Se um passo falhar o terceiro ponto, o hex volta. O ganho de 39% nao
vale um pixel de texto pior.
