# Relatório comparativo JEV × legado

_Gerado por `scripts/render-jev-eval.mjs` a partir de `docs/jev-eval-report.json`._

## Veredito

**Confianca NAO acionavel (pior ECE 0.116 acima de 0.10): nao exibir numeros de confianca na UI.**

| | |
| --- | --- |
| Tamanho do golden set | 23 casos |
| Candidato domina o baseline | sim |
| Curvas se cruzam | não |
| Confiança é acionável | não |
| Rótulos revisados por alguém | sim |
| ECE por repetição | 0.097, 0.099, 0.116 |

## Gate do §11

| Critério | Medida | | Leitura |
| --- | --- | :-: | --- |
| ECE <= 0.10 (calibracao) | 0.116 (pior de 3 repeticoes) | ✗ | O gate decide pelo **pior** de varias repeticoes. A acuracia do motor e estavel entre elas; o que varia e a confianca que ele anexa as respostas, e o ECE e penalizado por excesso de confianca. Com uma unica rodada, a decisao era uma moeda. |
| Acuracia seletiva no limiar de operacao | 90.9% sobre 22 respondidos | ✓ | Estavel em todas as rodadas. E a metrica que responde a pergunta do produto: quando o motor diz que esta seguro, ele acerta? |
| Cobertura no limiar de operacao | 91.3% | ✓ | O preco da seguranca: quantos casos sao respondidos quando se exige confianca alta. |
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

| Termos encontrados | 25 de 46 (54.3%) |
| Casos medidos | 13 de 23 com ground truth |
| Termos extras | 49 (a lista do revisor pode estar incompleta) |
| Termos encontrados (nome tolerante) | 34 de 46 (73.9%) |
| Termos extras (nome tolerante) | 38 |
| Funil, etapa 1: provider ofereceu | 84 definicoes (84 na 1a passada + 0 na cobertura) |
| Funil, etapa 2: repetidas descartadas | 0 |
| Funil, etapa 3: filtro deterministico recusou | 3 (3.6%) |
| Funil, etapa 4: chegaram ao motor | 81 |
| Funil, etapa 5: motor recusou | 7 |
| Funil, etapa 6: encontradas no ground truth | 25 |

**Onde morreram os termos ausentes (nome exato)**

| Etapa | Termos | Conserto |
| --- | ---: | --- |
| nunca proposto | 9 | prompt/cobertura |
| recusado pelo motor | 2 | julgamento do JEV |
| recusado pelo filtro | 1 | citacao/ancora |
| variacao de nome | 9 | metrica |
| Recusa do filtro (1x) | a citacao enviada nao aparece na nota |
| Recusa do filtro (2x) | o termo nao aparece na nota |

**Aceitas que nao casaram com o esperado** (sinonimo ou extra — revisar): ciclo-calvin: CO2; ciclo-calvin: tilacoide; ciclo-calvin: gradiente; contradicao-fotossintese: Calvin; contradicao-fotossintese: ciclo; contradicao-fotossintese: bandas; contradicao-fotossintese: espectro; termodinamica: adiabatico; bases-de-dados: registros; bases-de-dados: particionamento; contradicao-estroma: Calvin; contradicao-estroma: respiração; referencia-indefinida: Calvin; referencia-indefinida: cloroplastos; referencia-indefinida: glicólise; referencia-indefinida: fixação de carbono; passa-baixa-fronteira: unity; passa-baixa-fronteira: ordem do filtro; passa-baixa-fronteira: banda de passagem; passa-baixa-fronteira: atenuando; contradicao-quantidade: CO2; contradicao-quantidade: fase; contradicao-quantidade: cloroplasto; contradicao-quantidade: molécula; contradicao-quantidade: contagem corrigida; promessa-vazia: preço; promessa-vazia: demanda; promessa-vazia: quantidade; promessa-vazia: variação; promessa-vazia: curva; promessa-vazia: resposta; termo-sem-definicao: isolado; termo-sem-definicao: sistema; termo-sem-definicao: princípio; termo-sem-definicao: mínima; termo-sem-definicao: macroscópico; contradicao-maior: enzimas; contradicao-maior: pâncreas; contradicao-maior: intestino delgado; contradicao-maior: alcalino; lista-com-conteudo: professor; lista-com-conteudo: resumo; lista-com-conteudo: ciclo; lista-com-conteudo: semana; exemplo-numerico: incremento; exemplo-numerico: taxa; exemplo-numerico: relação; exemplo-numerico: valor; exemplo-numerico: desacelera

**Recusadas pelo filtro** (termo e motivo): ciclo-calvin: ribulose-1,5-bisfosfato (o termo nao aparece na nota); contradicao-fotossintese: materia-prima (o termo nao aparece na nota); passa-baixa-fronteira: Butterworth (a citacao enviada nao aparece na nota)

### Expansões de trecho (C12 ampliada)

| Expansoes oferecidas | 50 |
| Aceitas na ancora | 47 (94.0%) |
| Recusadas pelas checagens | 3 |
| Casos medidos | 21 de 23 |

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
| 0.4–0.5 | 1 | 0.0% | 46.0% | 46.0% |
| 0.5–0.6 | 4 | 50.0% | 55.5% | 5.5% |
| 0.6–0.7 | 1 | 100.0% | 69.0% | 31.0% |
| 0.7–0.8 | 1 | 100.0% | 76.0% | 24.0% |
| 0.8–0.9 | 5 | 100.0% | 84.2% | 15.8% |
| 0.9–1.0 | 11 | 100.0% | 94.1% | 5.9% |

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
| ECE | 0.116 | 0.611 |
| Brier | 0.0488 | — |
| Latência p50 | 0 ms | 8808 ms |
| Latência p95 | 0 ms | 20343 ms |
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
| `ciclo-calvin` | ready | ready | ✓ | 0.760 | ambiguous 24%, insufficient 0%, ready 76% |
| `somente-titulos` | insufficient | insufficient | ✓ | 0.990 | ambiguous 1%, insufficient 99%, ready 0% |
| `contradicao-fotossintese` | ambiguous | ambiguous | ✓ | 0.910 | ambiguous 91%, insufficient 0%, ready 9% |
| `termodinamica` | ready | ambiguous | ✗ | 0.550 | ambiguous 55%, insufficient 4%, ready 41% |
| `bases-de-dados` | ready | ready | ✓ | 0.880 | ambiguous 12%, insufficient 0%, ready 88% |
| `sistema-imunologico-limite` | insufficient | insufficient | ✓ | 0.950 | ambiguous 5%, insufficient 95%, ready 0% |
| `contradicao-estroma` | ambiguous | ambiguous | ✓ | 0.970 | ambiguous 97%, insufficient 0%, ready 3% |
| `referencia-indefinida` | ambiguous | ambiguous | ✓ | 0.900 | ambiguous 90%, insufficient 0%, ready 10% |
| `passa-baixa-fronteira` | ambiguous | ambiguous | ✓ | 0.570 | ambiguous 57%, insufficient 1%, ready 42% |
| `termo-definido-inline` | ready | ready | ✓ | 0.900 | ambiguous 9%, insufficient 1%, ready 90% |
| `somente-listas` | insufficient | insufficient | ✓ | 0.560 | ambiguous 40%, insufficient 56%, ready 4% |
| `contexto-implicito` | ready | ready | ✓ | 0.970 | ambiguous 3%, insufficient 0%, ready 97% |
| `contradicao-quantidade` | ambiguous | ambiguous | ✓ | 0.990 | ambiguous 99%, insufficient 0%, ready 1% |
| `promessa-vazia` | ready | ambiguous | ✗ | 0.540 | ambiguous 42%, insufficient 4%, ready 54% |
| `termo-sem-definicao` | ambiguous | ambiguous | ✓ | 0.830 | ambiguous 83%, insufficient 2%, ready 15% |
| `duas-afirmacoes` | ready | ready | ✓ | 0.940 | ambiguous 2%, insufficient 4%, ready 94% |
| `contradicao-maior` | ready | ready | ✓ | 0.820 | ambiguous 6%, insufficient 12%, ready 82% |
| `sem-sujeito` | insufficient | insufficient | ✓ | 0.690 | ambiguous 29%, insufficient 69%, ready 2% |
| `apenas-imagens` | insufficient | insufficient | ✓ | 0.910 | ambiguous 9%, insufficient 91%, ready 0% |
| `lista-com-conteudo` | insufficient | ambiguous | ✗ | 0.460 | ambiguous 35%, insufficient 19%, ready 46% |
| `conceito-isolado` | ready | ready | ✓ | 0.920 | ambiguous 3%, insufficient 5%, ready 92% |
| `contrato-implicito` | ready | ready | ✓ | 0.800 | ambiguous 4%, insufficient 16%, ready 80% |
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
| 0.00 | 23 de 23 | 87.0% | 13.0% | 0.0% | 0.116 | 0.0488 | 0.813 |
| 0.30 | 23 de 23 | 87.0% | 13.0% | 0.0% | 0.116 | 0.0488 | 0.813 |
| 0.50 | 22 de 23 | 90.9% | 9.1% | 4.3% | 0.116 | 0.0488 | 0.829 |
| 0.70 | 17 de 23 | 100.0% | 0.0% | 26.1% | 0.116 | 0.0488 | 0.901 |
| 0.85 | 13 de 23 | 100.0% | 0.0% | 43.5% | 0.116 | 0.0488 | 0.932 |
| 1.10 | 0 de 23 | — | — | 100.0% | 0.116 | 0.0488 | — |

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
| 0.55 | 91.3% | 95.2% |
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
