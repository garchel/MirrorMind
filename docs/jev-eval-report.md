# Relatório comparativo JEV × legado

_Gerado por `scripts/render-jev-eval.mjs` a partir de `docs/jev-eval-report.json`._

## Veredito

**Confianca NAO acionavel (pior ECE 0.150 acima de 0.10): nao exibir numeros de confianca na UI.**

| | |
| --- | --- |
| Tamanho do golden set | 23 casos |
| Candidato domina o baseline | sim |
| Curvas se cruzam | não |
| Confiança é acionável | não |
| Rótulos revisados por alguém | sim |
| ECE por repetição | 0.150, 0.114, 0.130 |

## Gate do §11

| Critério | Medida | | Leitura |
| --- | --- | :-: | --- |
| ECE <= 0.10 (calibracao) | 0.150 (pior de 3 repeticoes) | ✗ | O gate decide pelo **pior** de varias repeticoes. A acuracia do motor e estavel entre elas; o que varia e a confianca que ele anexa as respostas, e o ECE e penalizado por excesso de confianca. Com uma unica rodada, a decisao era uma moeda. |
| Acuracia seletiva no limiar de operacao | 93.8% sobre 16 respondidos | ✓ | Estavel em todas as rodadas. E a metrica que responde a pergunta do produto: quando o motor diz que esta seguro, ele acerta? |
| Cobertura no limiar de operacao | 72.7% | ✓ | O preco da seguranca: quantos casos sao respondidos quando se exige confianca alta. |
| Dominancia sobre o legado | 72.7% contra 61.1% | ✓ | O candidato e melhor ou igual em toda a curva de limiar. |
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
| `definitions` | casos | 0 de 23 | nao medida |

### Recall das sugestões de definição (C12)

_Nao medido._ Nenhum caso tem ground truth de definicoes (0 de 23 casos revisados). Isso nao e 0%: e ausencia de medida.

## As faixas de confiança (de onde sai o ECE)

O motor responde cada caso com uma confiança. O ECE pergunta: **quando ele diz
"estou 80% seguro", ele acerta 80% das vezes?**

Para responder, os casos são agrupados por confiança. Em cada grupo, compara-se
o que ele **disse que ia acertar** com o que **acertou de fato**. A diferença
de cada grupo, somada, dá o ECE.

| Confiança | Casos | Acertou | Disse que ia acertar | Diferença |
| --- | ---: | ---: | ---: | ---: |
| 0.2–0.3 | 1 | 0.0% | 28.0% | 28.0% |
| 0.3–0.4 | 2 | 50.0% | 35.5% | 14.5% |
| 0.4–0.5 | 3 | 0.0% | 40.3% | 40.3% |
| 0.6–0.7 | 2 | 50.0% | 62.5% | 12.5% |
| 0.7–0.8 | 1 | 100.0% | 77.0% | 23.0% |
| 0.8–0.9 | 4 | 100.0% | 83.5% | 16.5% |
| 0.9–1.0 | 9 | 100.0% | 95.7% | 4.3% |

## Comparação lado a lado

| | JEV (candidato) | Legado (baseline) |
| --- | --- | --- |
| Motor | `jev` / `jev-latest` | `legacy` / `qwen2.5:7b` |
| Casos do conjunto | 23 | 23 |
| **Casos respondidos** | **22** | **18** |
| Falhas (não respondeu) | 1 | 5 |
| Casos pontuados na métrica | 22 | 18 |
| Acurácia | 72.7% | 61.1% |
| Risco | 27.3% | 38.9% |
| ECE | 0.150 | 0.611 |
| Brier | 0.0681 | — |
| Latência p50 | 0 ms | 9009 ms |
| Latência p95 | 0 ms | 19755 ms |
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
| `ciclo-calvin` | ready | ready | ✓ | 0.610 | ambiguous 26%, insufficient 0%, ready 74% |
| `somente-titulos` | insufficient | insufficient | ✓ | 0.980 | ambiguous 1%, insufficient 99%, ready 0% |
| `contradicao-fotossintese` | ambiguous | ambiguous | ✓ | 0.950 | ambiguous 97%, insufficient 0%, ready 3% |
| `termodinamica` | ready | ambiguous | ✗ | 0.400 | ambiguous 60%, insufficient 7%, ready 33% |
| `bases-de-dados` | ready | ready | ✓ | 0.910 | ambiguous 6%, insufficient 0%, ready 94% |
| `sistema-imunologico-limite` | insufficient | insufficient | ✓ | 0.920 | ambiguous 5%, insufficient 95%, ready 0% |
| `contradicao-estroma` | ambiguous | ambiguous | ✓ | 1.000 | ambiguous 100%, insufficient 0%, ready 0% |
| `referencia-indefinida` | ambiguous | ambiguous | ✓ | 0.950 | ambiguous 97%, insufficient 0%, ready 3% |
| `passa-baixa-fronteira` | ambiguous | ambiguous | ✓ | 0.330 | ambiguous 44%, insufficient 1%, ready 55% |
| `termo-definido-inline` | ready | ready | ✓ | 0.880 | ambiguous 7%, insufficient 1%, ready 92% |
| `somente-listas` | insufficient | ambiguous | ✗ | 0.280 | ambiguous 39%, insufficient 52%, ready 9% |
| `contexto-implicito` | ready | ready | ✓ | 0.980 | ambiguous 1%, insufficient 0%, ready 99% |
| `contradicao-quantidade` | ambiguous | ambiguous | ✓ | 0.980 | ambiguous 99%, insufficient 0%, ready 1% |
| `promessa-vazia` | ready | ambiguous | ✗ | 0.400 | ambiguous 35%, insufficient 5%, ready 60% |
| `termo-sem-definicao` | ambiguous | ambiguous | ✓ | 0.770 | ambiguous 85%, insufficient 1%, ready 14% |
| `duas-afirmacoes` | ready | ready | ✓ | 0.860 | ambiguous 2%, insufficient 7%, ready 91% |
| `contradicao-maior` | ready | ready | ✓ | 0.800 | ambiguous 4%, insufficient 9%, ready 87% |
| `sem-sujeito` | insufficient | ambiguous | ✗ | 0.380 | ambiguous 39%, insufficient 59%, ready 2% |
| `apenas-imagens` | insufficient | insufficient | ✓ | 0.940 | ambiguous 4%, insufficient 96%, ready 0% |
| `lista-com-conteudo` | insufficient | ready | ✗ | 0.640 | ambiguous 19%, insufficient 5%, ready 76% |
| `contrato-implicito` | ready | ambiguous | ✗ | 0.410 | ambiguous 5%, insufficient 34%, ready 61% |
| `exemplo-numerico` | ready | ready | ✓ | 0.800 | ambiguous 12%, insufficient 1%, ready 87% |

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
| 0.00 | 22 de 22 | 72.7% | 27.3% | 0.0% | 0.150 | 0.0681 | 0.735 |
| 0.30 | 21 de 22 | 76.2% | 23.8% | 4.5% | 0.150 | 0.0681 | 0.757 |
| 0.50 | 16 de 22 | 93.8% | 6.3% | 27.3% | 0.150 | 0.0681 | 0.873 |
| 0.70 | 14 de 22 | 100.0% | 0.0% | 36.4% | 0.150 | 0.0681 | 0.909 |
| 0.85 | 11 de 22 | 100.0% | 0.0% | 50.0% | 0.150 | 0.0681 | 0.941 |
| 1.10 | 0 de 22 | — | — | 100.0% | 0.150 | 0.0681 | — |

## Fronteira de cobertura (candidato)

| Limiar | Cobertura | Acurácia |
| ---: | ---: | ---: |
| 0.00 | 100.0% | 72.7% |
| 0.05 | 100.0% | 72.7% |
| 0.10 | 100.0% | 72.7% |
| 0.15 | 100.0% | 72.7% |
| 0.20 | 100.0% | 72.7% |
| 0.30 | 95.5% | 76.2% |
| 0.35 | 90.9% | 75.0% |
| 0.40 | 86.4% | 78.9% |
| 0.55 | 72.7% | 93.8% |
| 0.60 | 72.7% | 93.8% |
| 0.70 | 63.6% | 100.0% |
| 0.80 | 59.1% | 100.0% |
| 0.85 | 50.0% | 100.0% |
| 0.95 | 18.2% | 100.0% |

## Falhas

**Candidato**

- `conceito-isolado` (readiness): As respostas da TypeSafe AI nao correspondem ao contrato solicitado.

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
