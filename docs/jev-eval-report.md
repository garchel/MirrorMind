# Relatório comparativo JEV × legado

_Gerado por `scripts/render-jev-eval.mjs` a partir de `docs/jev-eval-report.json`._

## Veredito

**Confianca NAO acionavel (pior ECE 0.120 acima de 0.10): nao exibir numeros de confianca na UI.**

| | |
| --- | --- |
| Tamanho do golden set | 23 casos |
| Candidato domina o baseline | sim |
| Curvas se cruzam | não |
| Confiança é acionável | não |
| Rótulos revisados por alguém | sim |
| ECE por repetição | 0.120, 0.105, 0.109 |

## Gate do §11

| Critério | Medida | | Leitura |
| --- | --- | :-: | --- |
| ECE <= 0.10 (calibracao) | 0.120 (pior de 3 repeticoes) | ✗ | O gate decide pelo **pior** de varias repeticoes. A acuracia do motor e estavel entre elas; o que varia e a confianca que ele anexa as respostas, e o ECE e penalizado por excesso de confianca. Com uma unica rodada, a decisao era uma moeda. |
| Acuracia seletiva no limiar de operacao | 91.3% sobre 23 respondidos | ✓ | Estavel em todas as rodadas. E a metrica que responde a pergunta do produto: quando o motor diz que esta seguro, ele acerta? |
| Cobertura no limiar de operacao | 87.0% | ✓ | O preco da seguranca: quantos casos sao respondidos quando se exige confianca alta. |
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

| Termos encontrados | 27 de 54 (50.0%) |
| Casos medidos | 15 de 23 com ground truth |
| Termos extras | 15 (a lista do revisor pode estar incompleta) |
| Termos encontrados (nome tolerante) | 31 de 54 (57.4%) |
| Termos extras (nome tolerante) | 11 |
| Funil, etapa 1: provider ofereceu | 67 definicoes (47 na 1a passada + 20 na cobertura) |
| Funil, etapa 2: repetidas descartadas | 1 |
| Funil, etapa 3: filtro deterministico recusou | 12 (17.9%) |
| Funil, etapa 4: chegaram ao motor | 54 |
| Funil, etapa 5: motor recusou | 12 |
| Funil, etapa 6: encontradas no ground truth | 27 |
| Recusa do filtro (2x) | a citacao enviada nao aparece na nota |
| Recusa do filtro (4x) | a definicao ja aparece na nota |
| Recusa do filtro (1x) | o termo e curto demais para ser um termo |
| Recusa do filtro (5x) | o termo nao aparece na nota |

**Aceitas que nao casaram com o esperado** (sinonimo ou extra — revisar): contradicao-fotossintese: fase clara; contradicao-fotossintese: glicose; termodinamica: adiabatico; bases-de-dados: consistencia; contradicao-estroma: ciclo de Calvin; referencia-indefinida: ciclo de Calvin; termo-definido-inline: tempo logarithmico; contexto-implicito: ciclo de Calvin; termo-sem-definicao: energia se conserva; termo-sem-definicao: energia; termo-sem-definicao: macroscópico; lista-com-conteudo: fase clara; lista-com-conteudo: fase escura; lista-com-conteudo: enzima rubisco; exemplo-numerico: capacidade de suporte do meio

**Recusadas pelo filtro** (termo e motivo): ciclo-calvin: tilacóide (a citacao enviada nao aparece na nota); ciclo-calvin: rubisco (a citacao enviada nao aparece na nota); ciclo-calvin: ribulose-1,5-bisfosfato (o termo nao aparece na nota); contradicao-fotossintese: fervura (o termo nao aparece na nota); bases-de-dados: chave primaria (a definicao ja aparece na nota); bases-de-dados: chave estrangeira (a definicao ja aparece na nota); bases-de-dados: indice (a definicao ja aparece na nota); termo-definido-inline: índice (a definicao ja aparece na nota); termo-definido-inline: árvore balanceada (o termo nao aparece na nota); termo-definido-inline: tabela hash (o termo nao aparece na nota); contradicao-quantidade: fixação de carbono (o termo nao aparece na nota); contradicao-maior: pH (o termo e curto demais para ser um termo)

### Expansões de trecho (C12 ampliada)

| Expansoes oferecidas | 41 |
| Aceitas na ancora | 40 (97.6%) |
| Recusadas pelas checagens | 1 |
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
| 0.5–0.6 | 4 | 75.0% | 54.0% | 21.0% |
| 0.6–0.7 | 2 | 50.0% | 63.0% | 13.0% |
| 0.7–0.8 | 1 | 100.0% | 75.0% | 25.0% |
| 0.8–0.9 | 6 | 100.0% | 85.5% | 14.5% |
| 0.9–1.0 | 10 | 100.0% | 94.6% | 5.4% |

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
| ECE | 0.120 | 0.611 |
| Brier | 0.0542 | — |
| Latência p50 | 0 ms | 10289 ms |
| Latência p95 | 0 ms | 15563 ms |
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
| `ciclo-calvin` | ready | ready | ✓ | 0.750 | ambiguous 25%, insufficient 0%, ready 75% |
| `somente-titulos` | insufficient | insufficient | ✓ | 0.990 | ambiguous 1%, insufficient 99%, ready 0% |
| `contradicao-fotossintese` | ambiguous | ambiguous | ✓ | 0.890 | ambiguous 89%, insufficient 0%, ready 11% |
| `termodinamica` | ready | ambiguous | ✗ | 0.600 | ambiguous 60%, insufficient 3%, ready 37% |
| `bases-de-dados` | ready | ready | ✓ | 0.900 | ambiguous 10%, insufficient 0%, ready 90% |
| `sistema-imunologico-limite` | insufficient | insufficient | ✓ | 0.920 | ambiguous 7%, insufficient 92%, ready 1% |
| `contradicao-estroma` | ambiguous | ambiguous | ✓ | 0.960 | ambiguous 96%, insufficient 0%, ready 4% |
| `referencia-indefinida` | ambiguous | ambiguous | ✓ | 0.880 | ambiguous 88%, insufficient 1%, ready 11% |
| `passa-baixa-fronteira` | ambiguous | ambiguous | ✓ | 0.530 | ambiguous 53%, insufficient 1%, ready 46% |
| `termo-definido-inline` | ready | ready | ✓ | 0.920 | ambiguous 7%, insufficient 1%, ready 92% |
| `somente-listas` | insufficient | insufficient | ✓ | 0.520 | ambiguous 44%, insufficient 52%, ready 4% |
| `contexto-implicito` | ready | ready | ✓ | 0.980 | ambiguous 2%, insufficient 0%, ready 98% |
| `contradicao-quantidade` | ambiguous | ambiguous | ✓ | 0.980 | ambiguous 98%, insufficient 0%, ready 2% |
| `promessa-vazia` | ready | ready | ✓ | 0.590 | ambiguous 37%, insufficient 4%, ready 59% |
| `termo-sem-definicao` | ambiguous | ambiguous | ✓ | 0.830 | ambiguous 83%, insufficient 1%, ready 16% |
| `duas-afirmacoes` | ready | ready | ✓ | 0.950 | ambiguous 2%, insufficient 3%, ready 95% |
| `contradicao-maior` | ready | ready | ✓ | 0.800 | ambiguous 8%, insufficient 12%, ready 80% |
| `sem-sujeito` | insufficient | insufficient | ✓ | 0.660 | ambiguous 32%, insufficient 66%, ready 2% |
| `apenas-imagens` | insufficient | insufficient | ✓ | 0.920 | ambiguous 8%, insufficient 92%, ready 0% |
| `lista-com-conteudo` | insufficient | ambiguous | ✗ | 0.520 | ambiguous 36%, insufficient 12%, ready 52% |
| `conceito-isolado` | ready | ready | ✓ | 0.940 | ambiguous 2%, insufficient 4%, ready 94% |
| `contrato-implicito` | ready | ready | ✓ | 0.850 | ambiguous 3%, insufficient 12%, ready 85% |
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
| 0.00 | 23 de 23 | 91.3% | 8.7% | 0.0% | 0.120 | 0.0542 | 0.816 |
| 0.30 | 23 de 23 | 91.3% | 8.7% | 0.0% | 0.120 | 0.0542 | 0.816 |
| 0.50 | 23 de 23 | 91.3% | 8.7% | 0.0% | 0.120 | 0.0542 | 0.816 |
| 0.70 | 17 de 23 | 100.0% | 0.0% | 26.1% | 0.120 | 0.0542 | 0.902 |
| 0.85 | 14 de 23 | 100.0% | 0.0% | 39.1% | 0.120 | 0.0542 | 0.926 |
| 1.10 | 0 de 23 | — | — | 100.0% | 0.120 | 0.0542 | — |

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
| 0.55 | 87.0% | 95.0% |
| 0.60 | 78.3% | 100.0% |
| 0.70 | 73.9% | 100.0% |
| 0.80 | 69.6% | 100.0% |
| 0.85 | 56.5% | 100.0% |
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
