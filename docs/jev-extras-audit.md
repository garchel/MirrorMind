# Auditoria dos 15 extras (rodada 3)

**Proveniência: agente, não revisor humano.** Estas classificações são uma
leitura do agente sobre a nota e a lista do revisor. Não entram no golden set
como ground truth sem confirmação humana — o campo `expectedDefinitionsProvenance`
continua `human` até alguém revisar.

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

## Resultado

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

### Os 9 legítimos (o gabarito é uma amostra, não um censo)

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

### O 1 falso positivo

`energia`, em `termo-sem-definicao`. A nota diz "a energia se conserva em um
sistema isolado". Energia é grandeza fundamental; defini-la na nota não
melhora a leitura, e o revisor esperava `sistema isolado` — o termo que a
frase realmente usa como premissa.

## O que isso muda nos números

| Medida | Antes | Depois da auditoria |
| --- | ---: | ---: |
| Recall (nome exato) | 19/47 (40,4%) | 19/47 — inalterado |
| Recall (com variante) | não medido | **21/47 (44,7%)** |
| Aceitas defensáveis | não medido | **30 de 34 (88%)** |
| Extras que são erro | "15" | **1** |

A conclusão inverte a hipótese registrada na §15.39 — "a cobertura dobrou o
ruído". O ruído era, em 11 dos 15 casos, o gabarito sendo incompleto. O motor
não está aceitando demais: **está acertando coisas que a lista não previu**.

## Consequências para o plano

1. **Consertar a métrica antes de mexer no prompt** (variante por contenção).
   Recupera 2 termos com zero mudança de modelo.
2. **Parar de tratar 47 como censo.** O alvo "47 de 47" é reproduzir a
   seleção de um revisor, não cobrir o que importa. A dupla honesta é
   *concordância com a lista* + *defensabilidade auditada do que foi aceito*.
3. **Reavaliar a prioridade do item 2** (redator enumerar em vez de julgar):
   continua valendo — as 24 ausências que nunca foram propostas são reais —
   mas o risco de "spray" é menor do que a §15.39 supôs.
4. **Pedir ao revisor humano para revisar os 9 legítimos e os 3 do assunto.**
   Se ele confirmar, o gabarito cresce de 47 para 56-59 termos sem nenhuma
   rodada nova, e o recall passa a medir o que se pretendia medir.

## Defeito de dados encontrado

A nota `contradicao-estroma` continha a frase:

> "...fixa o carbono atmosférico na molécula de **Accepted** glicose."

"Accepted" não é palavra do domínio: é resíduo de uma importação de revisão.
O mesmo texto aparecia em dois `sourceQuote` do golden set. Corrigido nesta
rodada (nota + 2 citações). A correção não muda nenhum termo esperado, mas
muda o texto que o motor lê — a próxima rodada é a primeira com a nota limpa.
