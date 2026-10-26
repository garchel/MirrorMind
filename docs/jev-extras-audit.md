# Auditoria dos 15 extras (rodada 3)

**Proveniência: agente + revisor humano.** A classificação original foi uma
leitura do agente sobre a nota e a lista do revisor. Ela foi submetida a
revisão humana em `docs/jev-extras-review.html`; as 15 decisões estão
transcritas em `docs/jev-extras-review-1792786835.json` (`reviewer: "human"`)
e são elas que entraram no golden set. Onde este documento diverge da decisão
humana, a decisão humana vence — as duas divergências estão registradas
abaixo.

Fonte: `docs/jev-eval-report.json`, rodada `1792786835`.
Reprodução: `node scripts/audit-extras.mjs` (imprime os 15 termos com a nota e o
gabarito de cada caso).

## Por que auditar

A leitura anterior era "o motor aceita demais: 34 aceitas, 19 do gabarito,
15 extras". Esse número não distingue três coisas com consertos opostos:

- **variante**: é o mesmo termo com outro nome — o erro é da métrica;
- **extra legítimo**: o termo realmente não está definido e o revisor não o
  listou — o erro é do gabarito;
- **falso positivo**: o termo não precisava de definição — o erro é do motor.

## Resultado da auditoria (leitura do agente)

| Veredito | Quantos | Significado |
| --- | ---: | --- |
| Variante do termo esperado | **2** | recall subestimado; conserto é a métrica |
| Extra legítimo (gabarito incompleto) | **9** | o motor acertou algo que a lista não previu |
| Assunto da nota | **3** | defensável, mas de baixo valor |
| Falso positivo | **1** | o motor aceitou demais |

### As 2 variantes (conserto de métrica)

| Caso | Aceito | Esperado |
| --- | --- | --- |
| `termodinamica` | `adiabatico` | `recipiente adiabatico` |
| `exemplo-numerico` | `capacidade de suporte do meio` | `capacidade de suporte` |

Nos dois casos o conhecimento que falta é o mesmo: quem define "recipiente
adiabático" define "adiabático"; quem define "capacidade de suporte do meio"
define "capacidade de suporte". Contar como erro **e** como extra é dupla
penalidade pelo mesmo fato.

### Os 9 legítimos segundo o agente (7 confirmados)

| Caso | Termo | Onde aparece sem definição |
| --- | --- | --- |
| `ciclo-calvin` | `fase escura` | "produto da fase escura do ciclo de Calvin" |
| `ciclo-calvin` | `fase clara` | "produzidos na fase clara" |
| `bases-de-dados` | `consistencia` | "O teorema CAP diz..." e "A consistência é o critério..." |
| `contradicao-estroma` | `glicose` | "fixa o carbono atmosférico na molécula de glicose" |
| `termo-definido-inline` | `tempo logarithmico` | "mantêm essa busca em tempo logarithmico" |
| `termo-definido-inline` | `complexidade média de busca` | "a mesma complexidade média de busca" |
| `contexto-implicito` | `Membranas tilacoidais` | "nas membranas tilacoidais" |
| `contradicao-quantidade` | `fase escura` | "consome 3 ATP e 2 NADPH na fase escura" |
| `lista-com-conteudo` | `fixacao de carbono` | "a fase escura usa essa energia para fixar carbono" |

Nenhum destes é erro do motor: todos são termos que a nota usa como premissa
sem explicar. A lista do revisor escolheu **alguns** dos termos que faltam, não
todos — que é o que uma lista humana faz.

### Os 3 do assunto

`ciclo de Calvin` aparece como extra em `contradicao-estroma`,
`referencia-indefinida` e `contexto-implicito` (neste último é o título).
Definir o mecanismo que dá nome à nota não ajuda o leitor da própria nota.
Não é erro factual, é baixo valor — e é o único lugar em que o motor mostra
uma preferência por "assunto" em vez de "premissa".

### O 1 falso positivo do agente (3 para o revisor)

`energia`, em `termo-sem-definicao`. A nota diz "a energia se conserva em um
sistema isolado". Energia é grandeza fundamental; defini-la na nota não
melhora a leitura, e o revisor esperava `sistema isolado` — o termo que a
frase realmente usa como premissa.

O revisor humano marcou ainda `consistencia` (em `bases-de-dados`) e
`tempo logarithmico` (em `termo-definido-inline`) como erro do motor, onde o
agente vira legítimo. Nos dois a premissa existe, mas o revisor considerou que
definir o termo não melhora a nota — é a fronteira entre "termo usado" e
"termo que vale definir", e ela é do revisor, não do agente.

## Revisão humana: 13 de 15 confirmados

O revisor humano julgou os 15 termos na mesma página, sem ver os números do
relatório. Resultado:

| Decisão humana | Termos | O agente tinha dito |
| --- | ---: | --- |
| `legitimo` | **7** | 9 |
| `assunto` | **3** | 3 |
| `erro` | **3** | 1 |
| `variante` | **2** | 2 |

**13 dos 15** coincidem com a auditoria do agente. As duas divergências são
ambas no mesmo sentido — o agente foi mais generoso que o revisor:

| Caso | Termo | Agente | Humano |
| --- | --- | --- | --- |
| `bases-de-dados` | `consistencia` | legítimo | **erro** |
| `termo-definido-inline` | `tempo logarithmico` | legítimo | **erro** |

Isso importa para a leitura do motor: dos 15 extras, 7 são gabarito incompleto,
2 são métrica, 3 são assunto e **3** são aceitação indevida. A taxa de
aceitação defensável (tudo menos erro) é 31 de 34 (91%), não 88%.

Aplicação no golden set: `node scripts/apply-extras-review.mjs
docs/jev-extras-review-1792786835.json`. Só `legitimo` altera o gabarito; o
script extrai a `sourceQuote` da própria nota e recusa gravar termo sem
citação literal. Resultado: **47 → 54 termos**, com `golden_integrity` verde.

## O que isso muda nos números

As linhas "depois" são a **remografia da mesma rodada** contra o gabarito novo:
os 7 termos confirmados já tinham sido aceitos pelo motor na rodada 3, então
entram como encontrados sem chamada nova. Não é uma rodada nova — é o mesmo
resultado medido contra um gabarito menos incompleto.

| Medida | Antes (47 termos) | Depois (54 termos) |
| --- | ---: | ---: |
| Recall (nome exato) | 19/47 (40,4%) | **26/54 (48,1%)** |
| Recall (nome tolerante) | 21/47 (44,7%) | **28/54 (51,9%)** |
| Extras (nome exato) | 15 | **8** |
| Extras (nome tolerante) | 13 | **6** |
| Extras que são erro | "15" -> 1 (agente) | **3** (humano) |

Dos 8 extras que restam em nome exato: 2 são variante (o conhecimento está
certo, o nome difere), 3 são assunto da nota e 3 são erro do motor. O motor
não está aceitando demais de forma generalizada — está acertando termos que a
lista não previu, e errando em 3.

## Consequências para o plano

1. **Consertar a métrica antes de mexer no prompt** (variante por contenção).
   Recupera 2 termos com zero mudança de modelo.
2. **Parar de tratar 47 como censo.** O alvo "47 de 47" é reproduzir a
   seleção de um revisor, não cobrir o que importa. A dupla honesta é
   *concordância com a lista* + *defensabilidade auditada do que foi aceito*.
3. **Reavaliar a prioridade do item 2** (redator enumerar em vez de julgar):
   continua valendo — as 24 ausências que nunca foram propostas são reais —
   mas o risco de "spray" é menor do que a §15.39 supôs.
4. **Revisar os 9 legítimos e os 3 do assunto** — **feito**. O revisor
   confirmou 7 dos 9 legítimos e os 3 assuntos; chamou 2 de erro. O gabarito
   cresceu de 47 para **54 termos** sem rodada nova.

## Como revisar

`docs/jev-extras-review.html` mostra os 15 termos um por um, com a frase onde
cada um aparece, o gabarito do caso e a sugestão da auditoria. As decisões
ficam no navegador e saem em JSON no botão de download. A página é gerada por
`node scripts/extras-review-page.mjs` a partir do relatório da rodada — na
próxima rodada, basta gerar de novo.

## Defeito de dados encontrado

A nota `contradicao-estroma` continha a frase:

> "...fixa o carbono atmosférico na molécula de **Accepted** glicose."

"Accepted" não é palavra do domínio: é resíduo de uma importação de revisão.
O mesmo texto aparecia em dois `sourceQuote` do golden set. Corrigido nesta
rodada (nota + 2 citações). A correção não muda nenhum termo esperado, mas
muda o texto que o motor lê — a próxima rodada é a primeira com a nota limpa.
