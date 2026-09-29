# Design system — amadurecimento da camada 1

Estado: branch `design-system-maturation`, apos `93a8a75` (as 3 camadas
+ os 4 gates). A estrutura esta pronta; o que falta e **maturidade**.

## Progresso

**456 → 278 primitivas (-39%).** Seis familias consolidadas, cada uma em
commit proprio, com os gates medindo o drift em vez de eu afirmar que
nao houve:

| familia | antes | depois | commit |
|---|---|---|---|
| `gold` | 53 | 15 | `6feb547` |
| `lilac` | 23 | 14 | `696499b` |
| `sage` | 40 | 31 | `b155a42` |
| `moss` | 17 | 12 | `b155a42` |
| `brick` | 39 | 35 | `b155a42` |
| `ink` | 161 | 75 | `d272497` |
| `clay` | 90 | 63 | `8f6fd78` |

Restam 17 tokens de ganho possivel (6,1%) — abaixo do limiar que vale a
risco de mover pixel. `sage`, `lilac` e `teal` estao esgotados.

**Drift acumulado:** 569 referencias, DeltaE max **2,29** — todas abaixo
do piso perceptual de 2,3. Os gates estritos continuam **falhando**, como
devem: a consolidacao move pixel, e isso precisa ficar visivel.

**Auditoria de contraste:** os 185 pares cor/fundo reais do app foram
medidos antes e depois de cada familia. Zero quebras de AA. Um par
melhorou (4,46 → 4,51). Maior variacao: 0,577 de razao.

## Pendencias conhecidas

1. **`--text-subtle` sobre `--surface-canvas` no tema claro: 2,40:1**
   (abaixo de AA). Pre-existente — era 2,30:1 antes da tokenizacao, ou
   seja a consolidacao melhorou marginalmente, mas o token segue
   inacessivel para texto pequeno. Precisa escurecer para ~`#8f8a80`
   (3,6:1) ou ~`#6b6a63` (5,3:1). Mudanca de cor visivel: decisao sua.
2. **Camada 3 sem uso.** `--button-*` esta definido, mas 117 botoes
   ainda com `className="secondary-button"` inline.
3. **Zero tokens de `font-size`.** 29 literais, 532 ocorrencias, sem
   escala. Proposta em `docs/type-scale-proposal.md` — 10 papeis, deriva
   de `scripts/type-scale.py`. Nao aplicada: o risco e layout, e nenhum
   gate mede layout.
4. **`--serif` nao existe.** 3 titulos da Revisao usam `var(--serif,
   var(--sans))`; se a intencao era uma serif de verdade para o relatorio
   de sintese, o token precisa ser criado de proposito.

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
