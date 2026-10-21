# Revisão dos rótulos de prontidão do golden set

Cada bloco é uma nota com o rótulo que o conjunto propõe. Julgue se o
rótulo está certo.

## Como julgar

A rubrica (a mesma que o app usa):

- **`ready`** — ideia central identificável, pelo menos 3 parágrafos com
  frase própria, nenhum termo usado como premissa sem definição, e nenhuma
  contradição entre parágrafos.
- **`ambiguous`** — pelo menos UM destes: premissa com termo indefinido; duas
  afirmações mutuamente exclusivas sobre o mesmo objeto; ou conteúdo
  delegado a anexos.
- **`insufficient`** — só listas, tarefas, imagens de anexo ou remissões. Nenhuma
  afirmação avaliável.

**Para cada caso, procure a evidência CONTRA o rótulo proposto antes de
responder.** Se ela for vazia, escreva isso — mas a ausência de evidência
contra não é evidência a favor. As respostas `ambiguous` e `insufficient` são
tão válidas quanto `ready`.

**Cite a frase da nota** que sustenta a sua leitura. É o que permite
auditar a revisão depois.

Responda **apenas** com o JSON do bloco.

---

## CASO `ciclo-calvin`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _A ideia central esta presente e ha cinco paragrafos autocontidos._

### A NOTA

```
# Ciclo de Calvin

A glicose e o principal produto da fase escura do ciclo de Calvin.

Essa fase ocorre no estroma dos cloroplastos e nao na membrana tilacoidal.

A fixacao de carbono usa a enzima rubisco, que adiciona CO2 a uma molecula de
ribulose-1,5-bisfosfato.

Cada molecula de CO2 fixado consome 3 ATP e 2 NADPH produzidos na fase clara.

A fotofosforilacao transloca protons para dentro do tilacoide, criando um
gradiente que alimenta a sintese de ATP.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "ciclo-calvin",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `somente-titulos`

Rótulo proposto: `insufficient`

Regra que o conjunto afirma ter seguido: _REGRA I1. A nota contem apenas titulos e uma referencia a outra nota, sem qualquer substantivo. Esta e a definicao literal de insufficient em READINESS_INSTRUCTIONS._

### A NOTA

```
# Estrutura da materia

- Introducao
- Conceitos
- Exercicios
- [[Notas relacionadas]]

```

### SUAS RESPOSTAS

```json
{
  "caseId": "somente-titulos",
  "proposed": "insufficient",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `contradicao-fotossintese`

Rótulo proposto: `ambiguous`

Regra que o conjunto afirma ter seguido: _REGRA A2. Ha duas frases adjacentes que se contradizem sobre a fase da fotossintese (escura e clara), sem nenhuma indicacao de qual esta correta. Contradicao interna e o criterio que leva a ambiguous._

### A NOTA

```
# Fotossintese

A energia luminosa e convertida em energia quimica durante a fotossintese.

A fotossintese ocorre na fase escura do ciclo de Calvin.

A fotossintese ocorre na fase clara, dentro dos tilacoides.

A clorofila absorve luz principalmente nas bandas azul e vermelha do espectro.

A glicose produzida serve de materia-prima para a respiracao celular.

A atmosfera terrestre possui cerca de 21% de oxigenio molecular.

A agua ferve a 100 graus Celsius ao nivel do mar sob pressao de 1 atmosfera.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "contradicao-fotossintese",
  "proposed": "ambiguous",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `termodinamica`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2. Duas secoes cada uma com paragrafos autocontidos, e a segunda contem enunciado de exercicio que sustenta uma pergunta._

### A NOTA

```
# Termodinamica

## Conceitos

A entropia mede o grau de desordem de um sistema termodinamico.

O calor nao flui espontaneamente de um corpo frio para um corpo quente.

## Exercicios

A entropia e uma propriedade extensiva.

Calcule a entropia de um recipiente adiabatico.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "termodinamica",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `bases-de-dados`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. Seis paragrafos autocontidos, cada um com um conceito avaliavel, e uma definicao clara de assunto._

### A NOTA

```
# Bases de dados

A chave primaria identifica unicamente cada linha de uma tabela.

Uma chave estrangeira estabelece uma relacao entre duas tabelas.

O indice acelera a busca de registros mas ocupa espaco em disco.

Uma transacao garante que um conjunto de operacoes seja executado por inteiro
ou desfeito por inteiro.

O teorema CAP diz que um banco nao pode garantir simultaneamente consistencia, disponibilidade e tolerancia a particionamento.

A consistencia e o criterio menos negociavel de um banco transacional.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "bases-de-dados",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `sistema-imunologico-limite`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _Fronteira. A nota tem titulos, anotacao substantiva e links, mas nenhuma secao se sustenta sozinha com tres pontos. Pode ser ready com missingContext, ou ambiguous. Depende de quanto se exige de contexto por secao, que e julgamento._

### A NOTA

```
# Sistema imunologico

# Anatomia

- Controle geral
- Controle especifico
- Subdivisoes

# Anotacoes

Responde a pergunta "por que isso acontece?".

```

### SUAS RESPOSTAS

```json
{
  "caseId": "sistema-imunologico-limite",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `contradicao-estroma`

Rótulo proposto: `ambiguous`

Regra que o conjunto afirma ter seguido: _REGRA A2 (contradicao interna). O paragrafo 1 afirma que a fixacao ocorre no estroma; o paragrafo 2 afirma que ocorre exclusivamente na membrana tilacoidal. Duas afirmacoes mutuamente exclusivas sobre o mesmo objeto. Verificavel por leitura direta, sem juizo._

### A NOTA

```
# Contradição entre seções

A segunda fase do ciclo de Calvin ocorre no estroma dos cloroplastos, onde a enzima rubisco fixa o carbono atmosférico na molécula de Accepted glicose.

Segundo o mesmo mecanismo, a fixação de carbono é realizada exclusivamente na membrana tilacoidal, nunca no estroma.

A glicose produzida é exportada para o citoplasma, onde pode ser convertida em amido ou usada na respiração.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "contradicao-estroma",
  "proposed": "ambiguous",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `referencia-indefinida`

Rótulo proposto: `ambiguous`

Regra que o conjunto afirma ter seguido: _REGRA A1 (premissa com termo indefinido). O paragrafo 2 usa 'como vimos antes' e compara a fixacao de carbono a glicolise aerobica, sem definir nenhuma das duas. O leitor nao tem o que avaliar. Diferente de contradicao: aqui falta informacao, nao ha informacao conflitante._

### A NOTA

```
# Referência indefinida

A segunda fase do ciclo de Calvin ocorre no estroma dos cloroplastos.

Como vimos antes, a fixação de carbono segue exatamente o mesmo caminho da glicólise aeróbica.

Cada molécula de CO2 fixado consome 3 ATP e 2 NADPH.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "referencia-indefinida",
  "proposed": "ambiguous",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `passa-baixa-fronteira`

Rótulo proposto: `ambiguous`

Regra que o conjunto afirma ter seguido: _Fronteira. A nota tem ideia central e tres paragrafos com frase propria, mas usa 'unity' sem definir (should ser ganho unitario) e a segunda frase orfa depende da primeira. Pode ser ready com missingContext, ou ambiguous. Depende de quanto se exige de contexto por sentenca, que e julgamento._

### A NOTA

```
# Filtro de passa-baixa

Um filtro de passa-baixa atenua frequências acima da sua frequência de corte, e para abaixo dela a resposta tende a unity.

A ordem do filtro define a inclinação final:Butterworth tem inclinacao de 20 dB por década, enquanto Chebyshev tem ondulação na banda de passagem.

Filtros de passa-alta fazem o complementar, atenuando abaixo da frequência de corte.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "passa-baixa-fronteira",
  "proposed": "ambiguous",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `termo-definido-inline`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. Ideia central identificavel no titulo e no primeiro paragrafo; tres paragrafos com frase propria; e o termo 'indice' e definido na propria frase que o usa, sem depender de nada anterior. E o par de contraste com 'referencia-indefinida': a unica diferenca e a definicao inline._

### A NOTA

```
# Termo definido inline

Um índice é uma estrutura de dados que associa chaves a valores, permitindo busca por chave em tempo que não depende do tamanho da coleção.

Árvores balanceadas mantêm essa busca em tempo logarithmico ao custo de rebalanceamento occasional na inserção.

Tabelas hash sacrificam ordem, mas trazem a mesma complexidade média de busca sem custo de rebalanceamento.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "termo-definido-inline",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `somente-listas`

Rótulo proposto: `insufficient`

Regra que o conjunto afirma ter seguido: _REGRA I1 (so listas e links). Nenhum paragrafo com conteudo substantivo: apenas tarefas, imagens de anexo e uma remocao a apendice. Nao ha material a avaliar._

### A NOTA

```
# Tarefas e links

## Leitura

- [ ] Resolver a lista 4 do capítulo 7
- [ ] Revisar o material do anexo A

## Referências

- ![diagrama](anexo-diagrama.png)
- ![fluxo](anexo-fluxo.png)

## Próximos passos

Ver o apêndice C.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "somente-listas",
  "proposed": "insufficient",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `contexto-implicito`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. Ideia central identificavel; tres paragrafos com frase propria; e o termo "fase escura" e definido no proprio paragrafo que o usa, sem depender de nada anterior. E o par de contraste com "termo-sem-definicao", que usa a mesma estrutura com um termo sem definicao._

### A NOTA

```
# Ciclo de Calvin

A fase escura do ciclo de Calvin usa a energia acumulada na fase clara para fixar carbono.

A fixação ocorre no estroma, o fluido interno do cloroplasto, onde a enzima rubisco catalisa a primeira etapa.

O ATP e o NADPH consumidos nesse processo vêm da fotofosforação que acontece nas membranas tilacoidais.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "contexto-implicito",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `contradicao-quantidade`

Rótulo proposto: `ambiguous`

Regra que o conjunto afirma ter seguido: _REGRA A2. Os paragrafos 1 e 2 dao numeros diferentes para o mesmo consumo: 3 ATP e 2 NADPH contra 5 ATP e 3 NADPH. O terceiro paragrafo nao tem problema. A divergencia e de quantidade, e nao de localizacao como em "contradicao-estroma" — o motor precisa distinguir os dois tipos._

### A NOTA

```
# Fotossíntese

Uma molécula de CO2 fixada consome 3 ATP e 2 NADPH na fase escura.

A fase escura consome 5 ATP e 3 NADPH por molécula de CO2 fixada, segundo a contagem corrigida.

A glicose formada é exportada do cloroplasto para o citoplasma.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "contradicao-quantidade",
  "proposed": "ambiguous",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `promessa-vazia`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. A nota tem titulo, ideia central, tres paragrafos que se sustentam e nenhum termo usado como premissa sem definicao. E o caso "sem-sujeito" invertido: aqui a estrutura esta presente, la nao esta._

### A NOTA

```
# Elasticidade

A elasticidade mede quanto a quantidade demandada responde a uma variação do preço.

Derivada da curva de demanda, tem unidades de resposta por unidade de preço.

Elasticidade-preço é negativa na maioria dos bens, e o sinal indica se a demanda é elástica ou inelástica.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "promessa-vazia",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `termo-sem-definicao`

Rótulo proposto: `ambiguous`

Regra que o conjunto afirma ter seguido: _REGRA A1. O terceiro paragrafo invoca "principio da minima entropia" sem defini-lo, e e esse termo que sustenta a conclusao do paragrafo. Nao ha contradicao, e nao ha informacao faltando fora de um termo especifico._

### A NOTA

```
# Termodinâmica

A primeira lei estabelece que a energia se conserva em um sistema isolado.

A entropia quantifica o número de microestados compatíveis com um estado macroscópico.

Segundo o princípio da mínima entropia, um sistema espontaneamente evolui no sentido que maximiza a entropia.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "termo-sem-definicao",
  "proposed": "ambiguous",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `duas-afirmacoes`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. Tres paragrafos, cada um definindo um conceito, e o terceiro relying no segundo sem pular etapas. Caso de contraste com "promessa-vazia", que tem a mesma forma mas so dois paragrafos de conteudo real._

### A NOTA

```
# Eletricidade

A corrente elétrica é a razão entre a carga que flui por um condutor e o tempo em que essa carga flui.

A tensão elétrica é a diferença de potencial que impulsiona esse fluxo.

A resistência de um material é a relação entre a tensão aplicada e a corrente resultante.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "duas-afirmacoes",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `contradicao-maior`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. Tres paragrafos autocontidos. Cuidado proposital: "pH varied" no primeiro paragrafo e um erro de digitacao que NAO e uma ambiguidade da nota, e nao deve ser confundido com uma. A nota continua sendo avaliavel._

### A NOTA

```
# Digestão

As enzimas digestivas atuam em pH varied, e cada enzima tem um pH ótimo.

A pepsina, enzima do estômago, tem pH ótimo em 2, o ambiente fortemente ácido.

A protease do pâncreas funciona melhor em pH 8, o meio alcalino do intestino delgado.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "contradicao-maior",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `sem-sujeito`

Rótulo proposto: `insufficient`

Regra que o conjunto afirma ter seguido: _REGRA I1. So listas e remissoes: nenhuma afirmacao avaliavel. Diferente de "somente-listas", que tambem e I1 mas tinha imagens; aqui o problema e a ausencia total de prosa._

### A NOTA

```
# Notas de leitura

Continuar no capítulo 5.

Reler o material do seminário.

Comparar com o que foi discutido em aula.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "sem-sujeito",
  "proposed": "insufficient",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `apenas-imagens`

Rótulo proposto: `insufficient`

Regra que o conjunto afirma ter seguido: _REGRA I1. Apenas imagens de anexo, sem uma unica linha de prosa. E o caso mais degenerado do conjunto: um motor que respondesse "ready" aqui estaria aceitando um conteudo que nao existe._

### A NOTA

```
# Arquivo

![diagrama do ciclo](anexo-ciclo.png)

![tabela de valores](anexo-valores.png)

![fluxo de etapas](anexo-fluxo.png)

```

### SUAS RESPOSTAS

```json
{
  "caseId": "apenas-imagens",
  "proposed": "insufficient",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `lista-com-conteudo`

Rótulo proposto: `ambiguous`

Regra que o conjunto afirma ter seguido: _REGRA A3. O conteudo esta delegado a um anexo, mas na total ausencia de prosa: e uma lista de tarefas com duas afirmacoes inline. Difere de "apenas-imagens" porque ha texto, e difere de "sem-sujeito" porque as duas afirmacoes da lista sao avaliaveis. E o caso mais proximo da fronteira, e por isso esta aqui._

### A NOTA

```
# Checklist de revisão

- [x] A fase clara captura energia luminosa e a fase escura usa essa energia para fixar carbono
- [x] A fixação de carbono ocorre no estroma e é catalisada pela enzima rubisco
- [ ] Reler a seção sobre fotofosforação antes da prova

Anotar: o professor pediu um resumo do ciclo para a semana que vem.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "lista-com-conteudo",
  "proposed": "ambiguous",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `conceito-isolado`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. Tres paragrafos, cada um com um conceito distinto, e o terceiro conecta os dois anteriores explicitamente. Estrutura canonica de nota pronta._

### A NOTA

```
# Propriedades

Propriedades governam o comportamento de um objeto, e cada objeto tem seu próprio conjunto de propriedades.

Encapsulamento é o mecanismo que impede o acesso direto ao estado interno de um objeto.

Herança permite que um tipo derive de outro e reutilize seu comportamento, mantendo o que é especifico de cada tipo.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "conceito-isolado",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `contrato-implicito`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. Tres paragrafos sobre compatibilidade, cada um definindo um termo antes de usa-lo. A nota nao tem a palavra "contra" e mesmo assim o criterio e o mesmo._

### A NOTA

```
# Contratos de API

Um contrato de API declara as entradas e as saidas de uma operacao.

Compatibilidade de entrada exige que o consumidor envie apenas o que o produtor aceita.

Compatibilidade de saida exige que o produtor continue devolvendo o que o consumidor espera ler.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "contrato-implicito",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

## CASO `exemplo-numerico`

Rótulo proposto: `ready`

Regra que o conjunto afirma ter seguido: _REGRA R1+R2+R3. Tres paragrafos, o segundo com um calculo verificavel, e o terceiro com o contraste para o caso nao exponencial. E o caso que tem mais substance por linha, para contrastar com "sem-sujeito"._

### A NOTA

```
# Crescimento populacional

O crescimento exponencial mantem a taxa de incremento constante em relação ao valor anterior.

Uma população que dobra a cada 30 anos leva cerca de 180 anos para crescer mil vezes.

O crescimento logistico desacelera quando a populacao se aproxima da capacidade de suporte do meio.

```

### SUAS RESPOSTAS

```json
{
  "caseId": "exemplo-numerico",
  "proposed": "ready",
  "agreed": null,
  "label": "",
  "evidenceAgainst": "",
  "evidenceFor": "",
  "notes": ""
}
```

---

