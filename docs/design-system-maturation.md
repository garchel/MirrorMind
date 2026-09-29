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

1. **Camada 3 sem uso — e nao e um find-and-replace.** `--button-*` esta
   definido em `styles/tokens/component.css`, mas 184 botoes continuam
   com `className="secondary-button"` inline. A distribuicao real:

   | composicao | ocorrencias |
   |---|---|
   | `secondary-button` | 97 |
   | `secondary-button danger-button` | 8 |
   | `primary-button` | 6 |
   | `primary-button review-start` | 3 |
   | `danger-button` isolado | 3 |
   | variantes com 3o token de contexto | o resto |

   E o CSS tem **38 regras de `.secondary-button`** e 5 de
   `.primary-button`, das quais **26 sao ajuste de contexto** (min-height
   19x, padding 19x, font-size 13x) por seletor de 3 classes. O proprio
   codigo admite: *"o seletor em 3 classes vence o `.secondary-button` do
   workspace"*. Um `<Button variant="secondary">` generico perde esses
   ajustes, porque eles sao o que diferencia o botao de 40px do header do
   botao de 28px do rail.

   O caminho e criar `<Button size="sm|md">` e deixar `className` aberto
   para o ajuste de contexto, em vez de tentar absorber tudo num enum.
   Isso toca muitos `.tsx` com E2E que fixam nome de botao; por isso fica
   para uma onda dedicada, com verificacao a cada passo.
2. **`--serif` criado (`b7a8354`).** 4 usos na Revisao. Agora existe de
   proposito e o acento serifado acontece.
3. **`.gitattributes` aplicado.** Resolve a falha de fixture em worktree
   novo: era 0/5, agora 991/991 com o arquivo em 377 bytes e zero CRLF.

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
5. **Tipografia** — hoje existem **zero** tokens de `font-size`. O app
   usa 12px (138x), 11px (69x), 13px (51x), 12.5px (41x), 10px (21x):
   14 tamanhos com decimais, todos literais. E a lacuna de sistema
   mais obvia que sobrou, e a unica que **nao** mexe em cor.
6. **Camada 3** — `--button-*` esta definido mas nenhum `.tsx` usa.
   117 botoes ainda com `className="secondary-button"` inline.

## Regra de decisao

Consolidacao **move pixels**, mesmo que imperceptivelmente. Por isso
cada familia so e aplicada depois de:

1. `cluster-primitives.py` mostrar o agrupamento (ja roda, so agrupa);
2. a tabela antes/depois ser revisada por olho humano;
3. os 4 gates passarem **e** o `verify-tokenization` continuar em zero
   divergencia para o que nao foi tocado.

Se um passo falhar o terceiro ponto, o hex volta. O ganho de 39% nao
vale um pixel de texto pior.
