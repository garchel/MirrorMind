# Golden set de calibracao (F1)

Conjunto de casos anotados para medir o motor calibrado (JEV) contra o caminho
legado. Formato definido em `src-tauri/src/review/calibrated/eval/golden.rs`.

## Por que existe

A documentacao do fornecedor relata ganho de velocidade e preco com workloads
montados pela propria equipe. Para decidir a migracao no MirrorMind, o unico
recurso confiavel e medir nos **nossos** casos, com rotulos que nao vieram de
um modelo.

## A regra de ouro: provenance

Todo rotulo declara de onde veio:

| `provenance` | Significado | Entra na metrica? |
| --- | --- | --- |
| `construction` | O rotulo segue de uma regra enunciada no proprio caso | sim |
| `commonFact` | O rotulo e um fato verificavel | sim |
| `human` | Alguem revisou e confirmou | sim |
| `disputed` | Fronteira que depende de julgamento | **nao** |

`disputed` existe para nao fingir certeza. Um caso limítrofe entre `ready` e
`ambiguous` e um assunto de opiniao: entrar na media como se fosse fato
contaminaria o numero sem deixar rastro. O harness **exclui** esses casos e
**lista** os ids na secao `unscoreable` do relatorio.

A forma curta (`"ready"`) conta como `construction`. Use a forma longa
quando o caso exigir justificativa:

```json
{"label": "ambiguous", "provenance": "construction", "why": "..."}
```

## As dimensoes e o que cada uma mede

O conjunto mede quatro dimensoes, e cada uma tem o proprio ground truth:

| dimensao | o que e | unidade |
|---|---|---|
| `readiness` | o rotulo de prontidao da nota | casos |
| `claims` | a veracidade de cada afirmacao factual | afirmacoes |
| `exchanges` | o status de cada troca da sessao | trocas |
| `definitions` | os termos que, definidos, melhorariam a nota | termos |

`golden.dimension_coverage()` diz, para cada dimensao, quantos itens tem
ground truth (`measured`) e quantos existem (`total`). E o relatorio carrega
essa cobertura.

A cobertura de `definitions` conta **casos** (23 de 23), mas o recall e medido
em **termos** (54): um caso revisado pode nao ter termo nenhum (8 dos 23 estao
nessa situacao, com `expectedDefinitions: []`), e essa lista vazia e uma
medida, nao uma ausencia. O denominador do recall e a soma dos termos.

**A diferenca entre "medido" e "nao medido" e o ponto.** Uma dimensao sem
ground truth nao produz erro: produz silencio. E `0/0` lido como "achou tudo"
e a forma mais facil de mentir num relatorio. Por isso o harness distingue
o caso revisado e vazio (`Some([])` — o revisor olhou e nao achou termo) do
caso nao revisado (`None` — ninguem olhou).

## Como os rotulos sao derivados

O conjunto NAO foi anotado por opinion. Cada nota foi **construida** para ter o
rotulo que ela tem:

- **so titulos e links** -> `insufficient`. E a definicao literal em
  `READINESS_INSTRUCTIONS`.
- **ideia central + tres ou mais paragrafos autocontidos** -> `ready`.
- **duas frases adjacentes que se contradizem** -> `ambiguous`, com
  `code: contradictory`.
- **secao que cita um termo sem defini-lo** -> `ready` com issue
  `missingContext`.
- **afirmacao factual** -> `commonFact`, conferivel sem opiniao.
- **resposta que repete a nota** -> `remembered`, por construcao da resposta.

## Ground truth das definicoes

Os 23 casos tem lista de termos revisada (`expectedDefinitionsProvenance:
human`), com **54 termos** no total. Todos os 54 tem `sourceQuote` — a linha da
nota onde o termo aparece, extraida do proprio texto, nunca digitada a mao.

A lista comecou em 47 termos, anotados com o auxilio de um agente. A revisao
humana aconteceu sobre os **termos que o motor aceitou e a lista nao previa**
(os "extras" da rodada 3), porque era ali que o gabarito podia estar
incompleto: 15 termos, decididos um a um em `docs/jev-extras-review.html` e
transcritos em `docs/jev-extras-review-1792786835.json`.

| decisao | termos | efeito no gabarito |
|---|---:|---|
| `legitimo` | 7 | **entra** como termo esperado |
| `variante` | 2 | nao entra: e o mesmo termo com outro nome |
| `assunto` | 3 | nao entra: e o tema da nota, nao premissa |
| `erro` | 3 | nao entra: o motor aceitou demais |

A aplicacao e feita por `node scripts/apply-extras-review.mjs <review.json>`,
que recusa gravar se algum termo nao tiver citacao literal na nota.

O recall tem duas leituras, e as duas aparecem no relatorio:

| campo | o que conta | rodada 3 |
|---|---|---:|
| `recall` | nome exato | 19/47 (40,4%) |
| `recallTolerant` | nome exato, prefixo ou sufixo (piso de 5 caracteres) | 21/47 (44,7%) |

O numero exato e o que compara com a serie historica; o tolerante mede o
quanto o gabarito depende de uma grafia especifica. A diferenca entre os dois
nao e erro de um dos lados: e uma propriedade do conjunto.

## O que ainda falta (e precisa de voce)

1. **Escala.** O alvo sao 40–60 notas. Ha 23. Cada nota nova precisa de uma
   regra de construcao, nao so de um rotulo. Alvo do plano: 30 casos
   pontuaveis.
2. **Qualidade das definicoes.** O conjunto diz **quais** termos faltam, nao
   **como** a definicao deveria ser. O relatorio guarda so o termo proposto,
   nunca o texto — por isso a qualidade textual das expansoes ainda nao tem
   ground truth e nao pode ser medida.
3. **Afirmacoes factuais.** A dimensao `claims` tem rotulos por afirmacao, mas
   a extracao de afirmacoes do pipeline (`extract_factual_claims`) ainda nao
   esta ligada: a dimensao existe no conjunto e nao e pontuada na rodada.

## Rodando

```bash
# So os testes do harness, sem rede:
cargo test --lib eval

# A medicao real (chave da TypeSafe AI no cofre + autorizacao de envio):
MIRRORMIND_JEV_EVAL=1 cargo test --test jev_eval -- --nocapture
```

O relatorio sai em `docs/jev-eval-report.json` e deve ser commitado junto de
qualquer migracao: e o baseline contra o qual a proxima rodada se compara.
---

## Rubrica de prontidao (v2)

Todo caso com `provenance: construction` precisa citar **o codigo da regra** que
produziu o rotulo. O codigo existe para que a revisao humana seja mecanica: o
revisor le `REGRA A2` e vai olhar se ha contradicao, sem precisar concordar com
a interpretacao de quem escreveu. Uma justificativa em prosa e uma opiniao bem
escrita.

| codigo | condicao | rotulo |
|---|---|---|
| `R1` | ideia central identificavel (titulo + primeiro paragrafo) | `ready` |
| `R2` | pelo menos 3 paragrafos, cada um com frase propria | `ready` |
| `R3` | nenhum termo tecnico usado como premissa sem definicao inline | `ready` |
| `R4` | nenhuma contradicao entre paragrafos | `ready` |
| `A1` | premissa com termo indefinido ("como vimos antes") | `ambiguous` |
| `A2` | duas afirmacoes mutuamente exclusivas sobre o mesmo objeto | `ambiguous` |
| `A3` | conteudo delegado a anexos ou notas externas | `ambiguous` |
| `I1` | apenas titulos, listas, tarefas ou imagens de anexo | `insufficient` |

`A2` e `A1` sao propositalmente distintos: em `A2` ha informacao conflitante, em
`A1` falta informacao. Um motor que so trata os dois igual erra em um dos lados.

Casos `disputed` **nao** pontuam. Sao fronteiras em que a resposta depende de
julgamento — e a funcao do golden set nao e medir o quanto o motor e
desambiguado, e sim o quanto ele acerta onde a resposta e Objetiva.

## Estado da revisao

**Os 23 rotulos de prontidao foram revisados** (`provenance: human`), com a
evidencia de quem revisou registrada no `why` de cada caso. Dois casos foram
reclassificados na revisao: `sistema-imunologico-limite` (ready -> insufficient)
e `lista-com-conteudo` (ambiguous -> insufficient). Nenhum caso esta
`disputed`: a revisao resolveu as duas fronteiras que existiam.

Isso muda o que o ECE mede. Antes, ele media concordancia com a construcao de
quem escreveu os casos — auto-concordancia. Agora mede concordancia com um
veredito de quem revisou.

A honestidade do conjunto nao depende mais de ter um caso `disputed`. Depende
de **toda dimensao declarar se foi medida**: `golden.dimension_coverage()`
devolve, por dimensao, quantos itens tem ground truth e quantos foram
medidos. Uma dimensao sem ground truth e "nao medida", e nao "medida com zero
erro". Hoje a dimensao `definitions` esta em **23 de 23 casos e 54 termos**,
`claims` tem 22 afirmacoes rotuladas e `exchanges` tem 5 trocas. O que falta
nessas duas ultimas nao e ground truth: e a extracao de afirmacoes do pipeline
(`extract_factual_claims`), que ainda nao esta ligada.

Alvo do plano: 30 casos pontuaveis. Hoje: 23 (todos revisados).
