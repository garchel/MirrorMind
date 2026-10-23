# Relatório comparativo JEV × legado

_Gerado por `scripts/render-jev-eval.mjs` a partir de `docs/jev-eval-report.json`._

## Veredito

**Confianca NAO acionavel (pior ECE 0.153 acima de 0.10): nao exibir numeros de confianca na UI.**

| | |
| --- | --- |
| Tamanho do golden set | 23 casos |
| Candidato domina o baseline | sim |
| Curvas se cruzam | não |
| Confiança é acionável | não |
| Rótulos revisados por alguém | sim |
| ECE por repetição | 0.147, 0.153, 0.137 |

## Gate do §11

| Critério | Medida | | Leitura |
| --- | --- | :-: | --- |
| ECE <= 0.10 (calibracao) | 0.153 (pior de 3 repeticoes) | ✗ | O gate decide pelo **pior** de varias repeticoes. A acuracia do motor e estavel entre elas; o que varia e a confianca que ele anexa as respostas, e o ECE e penalizado por excesso de confianca. Com uma unica rodada, a decisao era uma moeda. |
| Acuracia seletiva no limiar de operacao | 91.3% sobre 23 respondidos | ✓ | Estavel em todas as rodadas. E a metrica que responde a pergunta do produto: quando o motor diz que esta seguro, ele acerta? |
| Cobertura no limiar de operacao | 95.7% | ✓ | O preco da seguranca: quantos casos sao respondidos quando se exige confianca alta. |
| Dominancia sobre o legado | 91.3% contra 61.1% | ✓ | O candidato e melhor ou igual em toda a curva de limiar. |
| Vies de ordem (D12) | 0.0% de divergencia em 2 casos | ✓ | Opcao favorecida: remembered (2). |
| band_agreement (C5, sintese) | nao medido | — | A medicao existe mas nao entra na rodada. |
| Acerto de C5 contra a revisão humana | nao medido | — | Cada motor contra a banda que a revisão independente esperava. É a medida que decide o §11: **o legado acerta mais que o JEV** em `application` e `connections`, e empata em `core` e `gaps`. Contra esta evidência, migrar C5 pioraria o que o usuário vê. |
| C9/C10 (score agregado, evidencia) | nao implementado | — | A implementacao de C9/C10 nunca foi feita; C10 depende de corpus de revisoes (R-11). |

**1 critério(s) reprovado(s), 3 não medido(s).**

Um critério não medido não é um critério que passou. O gate está **parcialmente**
decidido: o que se sabe, sabe; o que falta, falta.

## O que foi medido, e o que não foi

Cada dimensão do golden set tem o seu próprio ground truth. Uma dimensão sem
ground truth não produz erro: produz **silêncio** — e o silêncio é o que o
leitor não percebe. Por isso o relatório diz "não medido" em vez de "0%".

| Dimensao | Unidade | Ground truth | Estado |
| --- | --- | ---: | --- |
| `readiness` | casos | 23 de 23 | completa |
| `claims` | afirmacoes | 22 de 22 | completa |
| `exchanges` | trocas | 5 de 5 | completa |
| `definitions` | casos | 23 de 23 | completa |

### Recall das sugestões de definição (C12)

| Termos encontrados | 19 de 47 (40.4%) |
| Casos medidos | 15 de 23 com ground truth |
| Termos extras | 15 (a lista do revisor pode estar incompleta) |
| Funil, etapa 1: provider ofereceu | 59 definicoes (38 na 1a passada + 21 na cobertura) |
| Funil, etapa 2: repetidas descartadas | 0 |
| Funil, etapa 3: filtro deterministico recusou | 12 (20.3%) |
| Funil, etapa 4: chegaram ao motor | 47 |
| Funil, etapa 5: motor recusou | 13 |
| Funil, etapa 6: encontradas no ground truth | 19 |
| Passada de cobertura falhou | 1 caso(s) — a 1a passada valeu sozinha |
| Recusa do filtro (2x) | a citacao enviada nao aparece na nota |
| Recusa do filtro (5x) | a definicao ja aparece na nota |
| Recusa do filtro (5x) | o termo nao aparece na nota |

**Aceitas que nao casaram com o esperado** (sinonimo ou extra — revisar): ciclo-calvin: fase escura; ciclo-calvin: fase clara; termodinamica: adiabatico; bases-de-dados: consistencia; contradicao-estroma: ciclo de Calvin; contradicao-estroma: glicose; referencia-indefinida: ciclo de Calvin; termo-definido-inline: tempo logarithmico; termo-definido-inline: complexidade média de busca; contexto-implicito: Ciclo de Calvin; contexto-implicito: Membranas tilacoidais; contradicao-quantidade: fase escura; termo-sem-definicao: energia; lista-com-conteudo: fixação de carbono; exemplo-numerico: capacidade de suporte do meio

### Expansões de trecho (C12 ampliada)

| Expansoes oferecidas | 37 |
| Aceitas na ancora | 34 (91.9%) |
| Recusadas pelas checagens | 3 |
| Casos medidos | 23 de 23 |

_A expansao nao tem ground truth. O numero acima mede a ancora, nao a qualidade do texto._

### Status das trocas (C1/C2)

| Trocas com o status certo | 5 de 5 (100.0%) |
| Casos medidos | 2 de 23 |

## As faixas de confiança (de onde sai o ECE)

O motor responde cada caso com uma confiança. O ECE pergunta: **quando ele diz
"estou 80% seguro", ele acerta 80% das vezes?**

Para responder, os casos são agrupados por confiança. Em cada grupo, compara-se
o que ele **disse que ia acertar** com o que **acertou de fato**. A diferença
de cada grupo, somada, dá o ECE.

| Confiança | Casos | Acertou | Disse que ia acertar | Diferença |
| --- | ---: | ---: | ---: | ---: |
| 0.5–0.6 | 4 | 75.0% | 55.5% | 19.5% |
| 0.6–0.7 | 1 | 0.0% | 64.0% | 64.0% |
| 0.7–0.8 | 2 | 100.0% | 75.0% | 25.0% |
| 0.8–0.9 | 8 | 100.0% | 84.6% | 15.4% |
| 0.9–1.0 | 8 | 100.0% | 95.4% | 4.6% |

## Comparação lado a lado

| | JEV (candidato) | Legado (baseline) |
| --- | --- | --- |
| Motor | `jev` / `jev-latest` | `legacy` / `qwen2.5:7b` |
| Casos do conjunto | 23 | 23 |
| **Casos respondidos** | **23** | **18** |
| Falhas (não respondeu) | 0 | 5 |
| Casos pontuados na métrica | 23 | 18 |
| Acurácia | 91.3% | 61.1% |
| Risco | 8.7% | 38.9% |
| ECE | 0.153 | 0.611 |
| Brier | 0.0549 | — |
| Latência p50 | 0 ms | 8805 ms |
| Latência p95 | 0 ms | 13326 ms |
| Custo total | US$ 0.000000 | US$ 0.000000 |

> O **ECE do legado é 0.611** porque o
> caminho legado não produz confiança nenhuma — e o harness trata a ausência
> de confiança como certeza. O resultado é que o legado é **confiante e errado**
> em 38.9% dos casos. É o argumento mais forte
> a favor do motor calibrado que os dados produceiram, e ele não aparece em
> nenhuma métrica de acurácia.

## Caso a caso (candidato)

| Caso | Esperado | Previsto | | Confiança | Distribuição |
| --- | --- | --- | :-: | ---: | --- |
| `ciclo-calvin` | ready | ready | ✓ | 0.790 | ambiguous 21%, insufficient 0%, ready 79% |
| `somente-titulos` | insufficient | insufficient | ✓ | 0.990 | ambiguous 1%, insufficient 99%, ready 0% |
| `contradicao-fotossintese` | ambiguous | ambiguous | ✓ | 0.890 | ambiguous 89%, insufficient 0%, ready 11% |
| `termodinamica` | ready | ambiguous | ✗ | 0.640 | ambiguous 64%, insufficient 3%, ready 33% |
| `bases-de-dados` | ready | ready | ✓ | 0.850 | ambiguous 15%, insufficient 0%, ready 85% |
| `sistema-imunologico-limite` | insufficient | insufficient | ✓ | 0.930 | ambiguous 6%, insufficient 93%, ready 1% |
| `contradicao-estroma` | ambiguous | ambiguous | ✓ | 0.970 | ambiguous 97%, insufficient 0%, ready 3% |
| `referencia-indefinida` | ambiguous | ambiguous | ✓ | 0.810 | ambiguous 81%, insufficient 1%, ready 18% |
| `passa-baixa-fronteira` | ambiguous | ambiguous | ✓ | 0.580 | ambiguous 58%, insufficient 1%, ready 41% |
| `termo-definido-inline` | ready | ready | ✓ | 0.890 | ambiguous 10%, insufficient 1%, ready 89% |
| `somente-listas` | insufficient | insufficient | ✓ | 0.510 | ambiguous 44%, insufficient 51%, ready 5% |
| `contexto-implicito` | ready | ready | ✓ | 0.970 | ambiguous 3%, insufficient 0%, ready 97% |
| `contradicao-quantidade` | ambiguous | ambiguous | ✓ | 0.980 | ambiguous 98%, insufficient 0%, ready 2% |
| `promessa-vazia` | ready | ready | ✓ | 0.580 | ambiguous 38%, insufficient 4%, ready 58% |
| `termo-sem-definicao` | ambiguous | ambiguous | ✓ | 0.810 | ambiguous 81%, insufficient 1%, ready 18% |
| `duas-afirmacoes` | ready | ready | ✓ | 0.940 | ambiguous 2%, insufficient 4%, ready 94% |
| `contradicao-maior` | ready | ready | ✓ | 0.820 | ambiguous 7%, insufficient 11%, ready 82% |
| `sem-sujeito` | insufficient | insufficient | ✓ | 0.710 | ambiguous 26%, insufficient 71%, ready 3% |
| `apenas-imagens` | insufficient | insufficient | ✓ | 0.930 | ambiguous 7%, insufficient 93%, ready 0% |
| `lista-com-conteudo` | insufficient | ready | ✗ | 0.550 | ambiguous 33%, insufficient 12%, ready 55% |
| `conceito-isolado` | ready | ready | ✓ | 0.920 | ambiguous 3%, insufficient 5%, ready 92% |
| `contrato-implicito` | ready | ready | ✓ | 0.820 | ambiguous 4%, insufficient 14%, ready 82% |
| `exemplo-numerico` | ready | ready | ✓ | 0.880 | ambiguous 11%, insufficient 1%, ready 88% |

## Caso a caso (baseline)

| Caso | Esperado | Previsto | | Confiança | Distribuição |
| --- | --- | --- | :-: | ---: | --- |
| `ciclo-calvin` | ready | ready | ✓ | — | — |
| `contradicao-fotossintese` | ambiguous | ready | ✗ | — | — |
| `termodinamica` | ready | ready | ✓ | — | — |
| `bases-de-dados` | ready | ready | ✓ | — | — |
| `referencia-indefinida` | ambiguous | ready | ✗ | — | — |
| `passa-baixa-fronteira` | ambiguous | ready | ✗ | — | — |
| `termo-definido-inline` | ready | ready | ✓ | — | — |
| `contexto-implicito` | ready | ready | ✓ | — | — |
| `contradicao-quantidade` | ambiguous | ready | ✗ | — | — |
| `promessa-vazia` | ready | ready | ✓ | — | — |
| `termo-sem-definicao` | ambiguous | ready | ✗ | — | — |
| `duas-afirmacoes` | ready | ready | ✓ | — | — |
| `contradicao-maior` | ready | ready | ✓ | — | — |
| `sem-sujeito` | insufficient | ready | ✗ | — | — |
| `lista-com-conteudo` | insufficient | ready | ✗ | — | — |
| `conceito-isolado` | ready | ready | ✓ | — | — |
| `contrato-implicito` | ready | ready | ✓ | — | — |
| `exemplo-numerico` | ready | ready | ✓ | — | — |

## Candidato por limiar

| Limiar | Pontuados | Acurácia | Risco | Abstention | ECE | Brier | Conf. média |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.00 | 23 de 23 | 91.3% | 8.7% | 0.0% | 0.153 | 0.0549 | 0.816 |
| 0.30 | 23 de 23 | 91.3% | 8.7% | 0.0% | 0.153 | 0.0549 | 0.816 |
| 0.50 | 23 de 23 | 91.3% | 8.7% | 0.0% | 0.153 | 0.0549 | 0.816 |
| 0.70 | 18 de 23 | 100.0% | 0.0% | 21.7% | 0.153 | 0.0549 | 0.883 |
| 0.85 | 12 de 23 | 100.0% | 0.0% | 47.8% | 0.153 | 0.0549 | 0.928 |
| 1.10 | 0 de 23 | — | — | 100.0% | 0.153 | 0.0549 | — |

## Fronteira de cobertura (candidato)

| Limiar | Cobertura | Acurácia |
| ---: | ---: | ---: |
| 0.00 | 100.0% | 91.3% |
| 0.05 | 100.0% | 91.3% |
| 0.10 | 100.0% | 91.3% |
| 0.15 | 100.0% | 91.3% |
| 0.20 | 100.0% | 91.3% |
| 0.30 | 100.0% | 91.3% |
| 0.35 | 100.0% | 91.3% |
| 0.40 | 100.0% | 91.3% |
| 0.55 | 95.7% | 90.9% |
| 0.60 | 82.6% | 94.7% |
| 0.70 | 78.3% | 100.0% |
| 0.80 | 69.6% | 100.0% |
| 0.85 | 47.8% | 100.0% |
| 0.95 | 17.4% | 100.0% |

## Falhas

**Candidato**

_Nenhuma falha._

**Baseline**

- `somente-titulos` (readiness): avaliacao invalida: o parse ou o grounding falhou
- `sistema-imunologico-limite` (readiness): avaliacao invalida: o parse ou o grounding falhou
- `contradicao-estroma` (readiness): avaliacao invalida: o parse ou o grounding falhou
- `somente-listas` (readiness): avaliacao invalida: o parse ou o grounding falhou
- `apenas-imagens` (readiness): avaliacao invalida: o parse ou o grounding falhou

## Fora da métrica

_Nenhum._

## Como ler isto

- **Risco** é a fração de casos respondidos que erraram. É o número que
  interessa: o portão de prontidão degrada para `ambiguous` quando o modelo
  não está seguro, e o que a tela mostra é esse status.
- **ECE** é a diferença média entre a confiança declarada e a acurácia
  observada. Perto de 0 é calibrado.
- **Abstention** é a fração de casos que o motor se recusa a responder no
  limiar. Subir o limiar compra acurácia ao custo de cobertura.
- Um **caso que falhou** não é um caso errado: é um caso que o motor não
  conseguiu responder. Compare "respondeu e errou" com "não respondeu".

## Ressalva

Os rótulos de prontidão do golden set **foram revisados por alguém**
(`provenance: human`), e a evidência de cada revisão está registrada no
`why` de cada caso. O ECE acima mede concordância com esse veredito
independente — não com a construção de quem escreveu os casos.

O golden set tem 23 casos; o plano pede 30
pontuáveis. Com 23 casos, um único veredito
invertido move a acurácia em 4.3% pontos, e o
intervalo de confiança é largo demais para separar "o portão funciona" de
"o portão é ruído".
