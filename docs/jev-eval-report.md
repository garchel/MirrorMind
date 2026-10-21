# Relatório comparativo JEV × legado

_Gerado por `scripts/render-jev-eval.mjs` a partir de `docs/jev-eval-report.json`._

## Veredito

**Confianca NAO acionavel (pior ECE 0.138 acima de 0.10): nao exibir numeros de confianca na UI.**

| | |
| --- | --- |
| Tamanho do golden set | 23 casos |
| Candidato domina o baseline | sim |
| Curvas se cruzam | não |
| Confiança é acionável | não |
| Rótulos revisados por alguém | sim |
| ECE por repetição | 0.123, 0.138, 0.112 |

## Gate do §11

| Critério | Medida | | Leitura |
| --- | --- | :-: | --- |
| ECE <= 0.10 (calibracao) | 0.138 (pior de 3 repeticoes) | ✗ | O gate decide pelo **pior** de varias repeticoes. A acuracia do motor e estavel entre elas; o que varia e a confianca que ele anexa as respostas, e o ECE e penalizado por excesso de confianca. Com uma unica rodada, a decisao era uma moeda. |
| Acuracia seletiva no limiar de operacao | 87.0% sobre 23 respondidos | ✓ | Estavel em todas as rodadas. E a metrica que responde a pergunta do produto: quando o motor diz que esta seguro, ele acerta? |
| Cobertura no limiar de operacao | 100.0% | ✓ | O preco da seguranca: quantos casos sao respondidos quando se exige confianca alta. |
| Dominancia sobre o legado | 87.0% contra 61.1% | ✓ | O candidato e melhor ou igual em toda a curva de limiar. |
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

| Termos encontrados | 16 de 47 (34.0%) |
| Casos medidos | 15 de 23 com ground truth |
| Termos extras | 0 (a lista do revisor pode estar incompleta) |

## As faixas de confiança (de onde sai o ECE)

O motor responde cada caso com uma confiança. O ECE pergunta: **quando ele diz
"estou 80% seguro", ele acerta 80% das vezes?**

Para responder, os casos são agrupados por confiança. Em cada grupo, compara-se
o que ele **disse que ia acertar** com o que **acertou de fato**. A diferença
de cada grupo, somada, dá o ECE.

| Confiança | Casos | Acertou | Disse que ia acertar | Diferença |
| --- | ---: | ---: | ---: | ---: |
| 0.5–0.6 | 3 | 33.3% | 56.7% | 23.3% |
| 0.6–0.7 | 3 | 100.0% | 63.0% | 37.0% |
| 0.7–0.8 | 2 | 50.0% | 73.0% | 23.0% |
| 0.8–0.9 | 3 | 100.0% | 87.7% | 12.3% |
| 0.9–1.0 | 12 | 100.0% | 95.6% | 4.4% |

## Comparação lado a lado

| | JEV (candidato) | Legado (baseline) |
| --- | --- | --- |
| Motor | `jev` / `jev-latest` | `legacy` / `qwen2.5:7b` |
| Casos do conjunto | 23 | 23 |
| **Casos respondidos** | **23** | **18** |
| Falhas (não respondeu) | 0 | 5 |
| Casos pontuados na métrica | 23 | 18 |
| Acurácia | 87.0% | 61.1% |
| Risco | 13.0% | 38.9% |
| ECE | 0.138 | 0.611 |
| Brier | 0.0620 | — |
| Latência p50 | 0 ms | 10462 ms |
| Latência p95 | 0 ms | 24773 ms |
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
| `ciclo-calvin` | ready | ready | ✓ | 0.700 | ambiguous 30%, insufficient 0%, ready 70% |
| `somente-titulos` | insufficient | insufficient | ✓ | 0.990 | ambiguous 1%, insufficient 99%, ready 0% |
| `contradicao-fotossintese` | ambiguous | ambiguous | ✓ | 0.970 | ambiguous 97%, insufficient 0%, ready 3% |
| `termodinamica` | ready | ambiguous | ✗ | 0.580 | ambiguous 58%, insufficient 5%, ready 37% |
| `bases-de-dados` | ready | ready | ✓ | 0.940 | ambiguous 6%, insufficient 0%, ready 94% |
| `sistema-imunologico-limite` | insufficient | insufficient | ✓ | 0.940 | ambiguous 5%, insufficient 94%, ready 1% |
| `contradicao-estroma` | ambiguous | ambiguous | ✓ | 1.000 | ambiguous 100%, insufficient 0%, ready 0% |
| `referencia-indefinida` | ambiguous | ambiguous | ✓ | 0.970 | ambiguous 97%, insufficient 0%, ready 3% |
| `passa-baixa-fronteira` | ambiguous | ready | ✗ | 0.550 | ambiguous 44%, insufficient 1%, ready 55% |
| `termo-definido-inline` | ready | ready | ✓ | 0.920 | ambiguous 7%, insufficient 1%, ready 92% |
| `somente-listas` | insufficient | insufficient | ✓ | 0.610 | ambiguous 33%, insufficient 61%, ready 6% |
| `contexto-implicito` | ready | ready | ✓ | 0.990 | ambiguous 1%, insufficient 0%, ready 99% |
| `contradicao-quantidade` | ambiguous | ambiguous | ✓ | 0.990 | ambiguous 99%, insufficient 0%, ready 1% |
| `promessa-vazia` | ready | ready | ✓ | 0.610 | ambiguous 35%, insufficient 4%, ready 61% |
| `termo-sem-definicao` | ambiguous | ambiguous | ✓ | 0.870 | ambiguous 87%, insufficient 1%, ready 12% |
| `duas-afirmacoes` | ready | ready | ✓ | 0.900 | ambiguous 2%, insufficient 8%, ready 90% |
| `contradicao-maior` | ready | ready | ✓ | 0.880 | ambiguous 5%, insufficient 7%, ready 88% |
| `sem-sujeito` | insufficient | insufficient | ✓ | 0.570 | ambiguous 41%, insufficient 57%, ready 2% |
| `apenas-imagens` | insufficient | insufficient | ✓ | 0.960 | ambiguous 4%, insufficient 96%, ready 0% |
| `lista-com-conteudo` | insufficient | ready | ✗ | 0.760 | ambiguous 19%, insufficient 5%, ready 76% |
| `conceito-isolado` | ready | ready | ✓ | 0.900 | ambiguous 3%, insufficient 7%, ready 90% |
| `contrato-implicito` | ready | ready | ✓ | 0.670 | ambiguous 5%, insufficient 28%, ready 67% |
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
| 0.00 | 23 de 23 | 87.0% | 13.0% | 0.0% | 0.138 | 0.0620 | 0.833 |
| 0.30 | 23 de 23 | 87.0% | 13.0% | 0.0% | 0.138 | 0.0620 | 0.833 |
| 0.50 | 23 de 23 | 87.0% | 13.0% | 0.0% | 0.138 | 0.0620 | 0.833 |
| 0.70 | 17 de 23 | 94.1% | 5.9% | 26.1% | 0.138 | 0.0620 | 0.915 |
| 0.85 | 15 de 23 | 100.0% | 0.0% | 34.8% | 0.138 | 0.0620 | 0.940 |
| 1.10 | 0 de 23 | — | — | 100.0% | 0.138 | 0.0620 | — |

## Fronteira de cobertura (candidato)

| Limiar | Cobertura | Acurácia |
| ---: | ---: | ---: |
| 0.00 | 100.0% | 87.0% |
| 0.05 | 100.0% | 87.0% |
| 0.10 | 100.0% | 87.0% |
| 0.15 | 100.0% | 87.0% |
| 0.20 | 100.0% | 87.0% |
| 0.30 | 100.0% | 87.0% |
| 0.35 | 100.0% | 87.0% |
| 0.40 | 100.0% | 87.0% |
| 0.55 | 100.0% | 87.0% |
| 0.60 | 87.0% | 95.0% |
| 0.70 | 69.6% | 93.8% |
| 0.80 | 65.2% | 100.0% |
| 0.85 | 65.2% | 100.0% |
| 0.95 | 30.4% | 100.0% |

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
