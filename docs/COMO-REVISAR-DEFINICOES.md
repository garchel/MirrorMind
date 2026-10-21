# Como revisar o ground truth da feature "Melhorar a nota"

Este guia é o passo que falta para a feature "Melhorar a nota" (C12) ter um
número. Sem ele, a recall da feature é **não medida** — e o relatório diz
isso explicitamente, em vez de mostrar `0%`.

## A pergunta que você vai responder

> **Que termo, definido, melhoraria esta nota?**

Não é "esta nota está pronta para revisão?" (essa pergunta já foi respondida
e revisada). A pergunta nova é sobre **termos**: a nota usa algum termo como
premissa sem nunca defini-lo, e defini-lo ajudaria quem estuda.

Para cada uma das 23 notas:

1. Leia a nota.
2. Ache os termos que ela usa como premissa **sem definir**.
3. Responda com a lista. **Se não houver nenhum, a lista é vazia** — e isso
   é uma resposta válida, não uma falha.

## O que é (e não é) um termo

**É:** um termo técnico que a nota usa como se o leitor já soubesse.

- `rubisco` em "a enzima rubisco, que adiciona CO2 a uma molécula" — a nota
  nunca diz o que é rubisco.
- `fase escura` se a nota nunca explica o que acontece nela.

**Não é:**

- Termo que a nota **define** na própria frase ("Um índice é uma estrutura
  de dados que...") — já está definido.
- Palavra comum de todo mundo ("nota", "arquivo", "página").
- Conceito geral que a nota não trata como premissa técnica.

## O formato da resposta

Um arquivo JSON com um objeto por caso:

```json
[
  {
    "caseId": "ciclo-calvin",
    "terms": [
      { "term": "rubisco", "sourceQuote": "a enzima rubisco, que adiciona CO2" }
    ]
  },
  { "caseId": "somente-titulos", "terms": [] }
]
```

`caseId` tem que ser **exatamente** o do bloco correspondente no pacote
(`ciclo-calvin`, `somente-titulos`, ...).

`sourceQuote` é a frase da nota onde o termo aparece. É opcional, mas com
ele a âncora pode ser conferida — e um termo que não existe na nota é um
erro que só apareceria depois, dentro de um número que ninguém sabe ler.

## Passo a passo

### 1. Pegar o pacote

O pacote já está pronto em `docs/golden-improvement-review.md` — 23 blocos,
um por nota, com o texto de cada nota. Se precisar regerá-lo:

```bash
node scripts/golden-improvement-review.mjs --file
```

### 2. Responder

Você pode responder **você mesmo** (leva uns 20 minutos) ou pedir a outro
modelo. Se pedir a outro modelo, cole o arquivo inteiro e peça:

> "Para cada bloco, responda apenas com o JSON do bloco: a lista de termos
> que a nota usa como premissa sem definir e que seriam úteis definir, com a
> citação onde o termo aparece. Se não houver nenhum, a lista é vazia."

Depois junte os JSONs em um único array (o importador também aceita um
objeto com `caseId` como chave).

### 3. Conferir antes de importar

```bash
node scripts/check-improvement-answers.mjs respostas.json
```

O verificador recusa a importação se algo estiver errado, e diz o quê:

| o que ele procura | por quê |
|---|---|
| todo caso do conjunto tem resposta | um caso faltando vira um número silenciosamente menor |
| nenhum caso repetido | resposta repetida sobrescreve a anterior |
| o termo aparece **literalmente** na nota | a medição compara o texto exato |
| a citação aparece **literalmente** na nota | a âncora tem que ser conferível |

A palavra "literalmente" é importante: se você escrever "fase escura" e a
nota escrever "a fase escura", a citação não casa — e o problema seria seu,
não do pipeline.

### 4. Importar

```bash
node scripts/golden-improvement-import.mjs respostas.json
```

Isso grava `expectedDefinitions` e `expectedDefinitionsProvenance` em cada
caso do golden set (`src-tauri/tests/fixtures/jev-golden/golden.json`).

### 5. Medir

```bash
cd src-tauri
MIRRORMIND_JEV_EVAL=1 MIRRORMIND_JEV_EVAL_VAULT="C:\Users\paulo\OneDrive\Documentos\MirrorMind Vault" cargo test --test jev_eval -- --ignored --nocapture
```

A linha que importa:

```
recall de definicoes: 3/4 termos encontrados (75%) em 3 de 3 casos com ground truth
```

Antes da revisão ela sai assim:

```
recall de definicoes: NAO MEDIDO — nenhum caso tem ground truth de definicoes (0 de 23 casos revisados). Isso nao e 0%: e ausencia de medida.
```

### 6. Ver o relatório

```bash
node scripts/render-jev-eval.mjs
```

A tabela "O que foi medido, e o que não foi" passa a mostrar `definitions`
como medida, e a seção "Recall das sugestões de definição (C12)" mostra o
número.

## Como ler o número

O número é **recall**, não precisão. Isso é deliberado.

A sua lista pode estar incompleta — talvez você tenha deixado passar um
termo. Se a métrica fosse precisão, uma proposta fora da sua lista seria
contada como falso positivo, mesmo que você apenas não a viu. Isso puniria
a sua lista por ser incompleta.

O recall não sofre disso: pergunta **das definições que você disse que
melhorariam a nota, quantas o pipeline encontrou?** Essa pergunta tem
resposta certa mesmo com a lista incompleta.

O relatório também mostra **termos extras** — os que o pipeline propôs e
você não listou. Não é erro: é contexto. Se aparecerem muitos termos
absurdos ("continuar", "Conceitos"), o problema está no filtro
determinístico, não na sua lista.

## O que fazer se o número for ruim

| sintoma | o que significa |
|---|---|
| recall baixo (< 50%) | o pipeline não acha os termos que você viu |
| recall alto, muitos termos extras | o pipeline acha demais — o filtro está frouxo |
| recall alto, poucos extras | está funcionando |

O caso `referencia-indefinida` é o teste canônico: a nota usa "glicólise
aeróbica" como premissa sem definir. Se o pipeline não acha, o filtro
determinístico tem um buraco.

## O que esta revisão NÃO mede

Ela mede a **dimensão das definições**, que é outra pergunta que a de
prontidão. Avaliar a feature contra os rótulos de prontidão mediria a coisa
errada — é o que o §15.26 do plano registra.

Por isso o golden set tem duas dimensões com proveniência separada:
`readiness.provenance` (já revisado) e `expectedDefinitionsProvenance` (esta
revisão).
