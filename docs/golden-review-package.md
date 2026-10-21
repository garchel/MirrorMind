# Pacote de revisão das sínteses do golden set

Cada bloco abaixo é um caso. O bloco inteiro (nota + síntese) deve ser
avaliado de forma independente, sem comparar com os outros casos.

## O que fazer com cada bloco

1. Leia a **nota** inteira.
2. Leia a **síntese** inteira.
3. Para cada uma das 4 dimensões, **procure primeiro a evidência
   contra** e depois a evidência a favor. Se a evidência contra for
   vazia, escreva isso explicitamente — mas a ausência de evidência
   contra não é o mesmo que evidência a favor.
4. Responda as 2 perguntas extras.

Responda **apenas** com o JSON do bloco, sem texto em volta.

---

## CASO `ciclo-calvin`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

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

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que o ciclo de Calvin tem duas fases, e a escura usa o ATP e o NADPH produzidos na clara para fixar carbono em glicose. Os conceitos se conectam porque a energia captada na fase clara e exatamente o que paga a fixacao na fase escura, e o produto final de uma e a entrada da outra. Isso se aplica quando eu quiser entender como um processo de varias etapas pode acumular energia antes de gasta-la, e por que as etapas nao podem ser trocadas de ordem. Ainda nao sei bem por que a rubisco prefere o CO2 e nao o O2, nem o que muda no ciclo quando isso e alterado.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "ciclo-calvin",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `divisibilidade`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ambiguous`

### NOTA

```
# Divisibilidade

A energia luminosa e convertida em energia quimica durante a fotossintese.

A fotossintese ocorre na fase escura do ciclo de Calvin.

A fotossintese ocorre na fase clara, dentro dos tilacoides.

A clorofila absorve luz principalmente nas bandas azul e vermelha do espectro.

A glicose produzida serve de materia-prima para a respiracao celular.

A atmosfera terrestre possui cerca de 21% de oxigenio molecular.

A agua ferve a 100 graus Celsius ao nivel do mar sob pressao de 1 atmosfera.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a divisibilidade e uma relacao entre inteiros, e que e a base da construcao das fracoes. Os conceitos se conectam porque dividir por um numero nao e o inverso de multiplicar quando o numero nao e primo, e e essa diferenca entre dividir por 2 e dividir por 3 que estrutura a aritmetica. Isso se aplica quando eu for entender por que 1/2 e 1/3 somam para algo diferente de 1/6, e por que isso importa. Ainda nao sei bem por que o conjunto dos primos parece tao especial, se e a fatoracao que importa ou outra coisa.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "divisibilidade",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `termodinamica`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Termodinamica

## Conceitos

A entropia mede o grau de desordem de um sistema termodinamico.

O calor nao flui espontaneamente de um corpo frio para um corpo quente.

## Exercicios

A entropia e uma propriedade extensiva.

Calcule a entropia de um recipiente adiabatico.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a energia se conserva em um sistema isolado, e a entropia mede a desordem termodinamica. Os conceitos se conectam porque a segunda lei diz que a entropia de um sistema isolado nunca diminui, e e por isso que o calor flui do quente para o frio e nunca o contrario. Isso se aplica quando eu quiser prever se um processo espontaneo vai na direcao que observei ou na oposta, sem precisar balancear todas as energias. Ainda nao sei bem como a entropia se comporta em um sistema que nao esta isolado, que e o caso de quase tudo que me interessa.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "termodinamica",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `bases-de-dados`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

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

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que um indice associa chaves a valores e permite buscar por chave sem percorrer a colecao inteira. Os conceitos se conectam porque arvores balanceadas e tabelas hash resolvem o mesmo problema de formas diferentes, trocando o custo de rebalancear pelo custo de perder a ordem. Isso se aplica quando eu precisar escolher a estrutura de um mapa em codigo real, lembrando que hash da a mesma complexidade media mas exige que a chave seja hashavel. Ainda nao sei bem como dimensionar a tabela hash para evitar rehashes em carga alta.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "bases-de-dados",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `sistema-imunologico-limite`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Sistema imunologico

# Anatomia

- Controle geral
- Controle especifico
- Subdivisoes

# Anotacoes

Responde a pergunta "por que isso acontece?".
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que o sistema imune identifica padroes moleculares e dispara uma resposta cujo alcance depende do contexto em que o padrao aparece. Os conceitos se conectam porque a mesma assinatura molecular pode ser inofensiva num lugar e perigosa em outro, e e o contexto que desambigua. Isso se aplica quando eu for entender por que uma pessoa pode ser alergica a uma substancia que outras toleram, que e uma questao de contexto e nao de substancia. Ainda nao sei bem o que determina o contexto nesse caso, se e a frequencia, o lugar, ou o historico do organismo.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "sistema-imunologico-limite",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `contradicao-estroma`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ambiguous`

### NOTA

```
# Contradição entre seções

A segunda fase do ciclo de Calvin ocorre no estroma dos cloroplastos, onde a enzima rubisco fixa o carbono atmosférico na molécula de Accepted glicose.

Segundo o mesmo mecanismo, a fixação de carbono é realizada exclusivamente na membrana tilacoidal, nunca no estroma.

A glicose produzida é exportada para o citoplasma, onde pode ser convertida em amido ou usada na respiração.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a fase escura do ciclo de Calvin fixaria carbono no estroma, e o resultado seria a glicose. Os conceitos se conectam porque a fixacao depende da energia captada na fase clara, e e por isso que as duas fases nao podem ser lidas separadamente. Isso se aplica quando eu for explicar a fotossintese a alguem que entendeu so uma das fases, porque entender so a clara leva a uma ideia errada do custo. Ainda nao sei bem em que ponto do cloroplasto isso acontece, porque o texto diz o estroma e tambem diz a membrana tilacoidal, e nao podem ser os dois.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "contradicao-estroma",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `referencia-indefinida`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ambiguous`

### NOTA

```
# Referência indefinida

A segunda fase do ciclo de Calvin ocorre no estroma dos cloroplastos.

Como vimos antes, a fixação de carbono segue exatamente o mesmo caminho da glicólise aeróbica.

Cada molécula de CO2 fixado consome 3 ATP e 2 NADPH.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a fase escura do ciclo de Calvin consome ATP e NADPH da fase clara para fixar carbono, e o resultado e a glicose. Os conceitos se conectam porque e a mesma energia captada na luz que paga a construcao do acucar, e as duas fases nao podem ser lidas separadamente. Isso se aplica quando eu for explicar a fotossintese a alguem que entendeu so uma das fases, porque entender so a clara leva a uma ideia errada do custo. Ainda nao sei bem por que a fixacao de carbono precisa de energia se ela e uma construcao de acucar, parece o contrario do que eu esperaria.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "referencia-indefinida",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `passa-baixa-fronteira`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ambiguous`

### NOTA

```
# Filtro de passa-baixa

Um filtro de passa-baixa atenua frequências acima da sua frequência de corte, e para abaixo dela a resposta tende a unity.

A ordem do filtro define a inclinação final:Butterworth tem inclinacao de 20 dB por década, enquanto Chebyshev tem ondulação na banda de passagem.

Filtros de passa-alta fazem o complementar, atenuando abaixo da frequência de corte.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que um filtro de passa-baixa atenua as frequencias acima da frequencia de corte e deixa passar as de baixo, e que a ordem dos filtros define a inclinacao final da resposta. Os conceitos se conectam porque a ordem altera a inclinacao, e por isso dois filtros com a mesma especificacao podem responder de forma diferente. Isso se aplica quando eu for implementar um filtro digital e escolher a ordem, lembrando que a resposta em frequencia e o que importa, e nao a forma do sinal. Ainda nao sei bem o que a expressao unity quer dizer aqui, e por que a resposta tende a unity abaixo da corte.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "passa-baixa-fronteira",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `termo-definido-inline`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Termo definido inline

Um índice é uma estrutura de dados que associa chaves a valores, permitindo busca por chave em tempo que não depende do tamanho da coleção.

Árvores balanceadas mantêm essa busca em tempo logarithmico ao custo de rebalanceamento occasional na inserção.

Tabelas hash sacrificam ordem, mas trazem a mesma complexidade média de busca sem custo de rebalanceamento.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que um indice associa chaves a valores, e que arvores balanceadas e tabelas hash sao as duas formas de manter a busca por chave barata. Os conceitos se conectam porque a arvore garante o custo logarithmico ao custo de rebalancear na insercao, e a tabela hash da a mesma complexidade media ao custo de perder a ordem. Isso se aplica quando eu for escolher a estrutura de um dicionario em codigo, e a resposta muda se eu preciso de ordem ou nao. Ainda nao sei bem qual e a complexidade do pior caso de uma tabela hash, que e o que me preocupa quando a entrada pode ser adversaria.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "termo-definido-inline",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `contexto-implicito`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Ciclo de Calvin

A fase escura do ciclo de Calvin usa a energia acumulada na fase clara para fixar carbono.

A fixação ocorre no estroma, o fluido interno do cloroplasto, onde a enzima rubisco catalisa a primeira etapa.

O ATP e o NADPH consumidos nesse processo vêm da fotofosforação que acontece nas membranas tilacoidais.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a fase escura do ciclo de Calvin consome o ATP e o NADPH da fase clara para fixar carbono em glicose, e isso acontece no estroma. Os conceitos se conectam porque a fixacao de carbono e a fotofosforacao sao as duas metades da mesma transducao de energia, e a segunda produz o que a primeira gasta. Isso se aplica quando eu for explicar a alguem por que uma planta precisa de luz para crescer, e a resposta nao e a luz vira acucar e sim a luz vira a moeda que paga a construcao do acucar. Ainda nao sei bem qual parte dessa nota e a mais dificil de memorizar, se a divisao em duas fases ou o papel da rubisco.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "contexto-implicito",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `contradicao-quantidade`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ambiguous`

### NOTA

```
# Fotossíntese

Uma molécula de CO2 fixada consome 3 ATP e 2 NADPH na fase escura.

A fase escura consome 5 ATP e 3 NADPH por molécula de CO2 fixada, segundo a contagem corrigida.

A glicose formada é exportada do cloroplasto para o citoplasma.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a fase escura do ciclo de Calvin consome ATP e NADPH para fixar carbono, e o resultado e a glicose. Os conceitos se conectam porque a razao de 3 ATP e 2 NADPH por molecula e o que define o custo energetico de transformar CO2 em acucar. Isso se aplica quando eu for calcular quanto CO2 uma planta precisa fixar para produzir determinada quantidade de biomassa, ou o contrario. Ainda nao sei bem quanto ATP e NADPH sao consumidos por molecula, porque o texto da dois numeros diferentes.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "contradicao-quantidade",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `promessa-vazia`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Elasticidade

A elasticidade mede quanto a quantidade demandada responde a uma variação do preço.

Derivada da curva de demanda, tem unidades de resposta por unidade de preço.

Elasticidade-preço é negativa na maioria dos bens, e o sinal indica se a demanda é elástica ou inelástica.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a elasticidade mede quanto a quantidade demandada responde a uma variacao do preco, e ela e negativa na maioria dos bens. Os conceitos se conectam porque a elasticidade e a inclinacao da curva de demanda, e e o sinal dela que diz se a demanda e elastica ou inlastica. Isso se aplica quando eu for decidir se um imposto sobe ou desce o preco ao consumidor, porque a resposta depende da elasticidade da demanda naquele mercado. Ainda nao sei bem como se estima a elasticidade quando nao se tem dados de mercado, e sim so teoria.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "promessa-vazia",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `termo-sem-definicao`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ambiguous`

### NOTA

```
# Termodinâmica

A primeira lei estabelece que a energia se conserva em um sistema isolado.

A entropia quantifica o número de microestados compatíveis com um estado macroscópico.

Segundo o princípio da mínima entropia, um sistema espontaneamente evolui no sentido que maximiza a entropia.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a primeira lei da termodinamica diz que a energia se conserva, e que a entropia mede a desordem de um sistema. Os conceitos se conectam porque a segunda lei restringe o que pode acontecer mesmo com a energia conservada, e e ela que impede que o calor suba sozinho. Isso se aplica quando eu for entender por que um processo espontaneo tem direcao, e nao apenas por que a energia nao some. Ainda nao sei bem o que exatamente o principio da minima entropia acrescenta a segunda lei, porque o texto usa o termo sem defini-lo.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "termo-sem-definicao",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `duas-afirmacoes`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Eletricidade

A corrente elétrica é a razão entre a carga que flui por um condutor e o tempo em que essa carga flui.

A tensão elétrica é a diferença de potencial que impulsiona esse fluxo.

A resistência de um material é a relação entre a tensão aplicada e a corrente resultante.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que corrente, tensao e resistencia sao as tres grandezas de um circuito, ligadas pela lei de Ohm. Os conceitos se conectam porque a corrente e a razao entre carga e tempo, a tensao e a diferenca de potencial que impulsiona o fluxo, e a resistencia e a relacao entre as duas, o que faz das tres faces da mesma equacao. Isso se aplica quando eu for montar um circuito simples, ou entender por que um componente aquece mais em uma configuracao do que em outra. Ainda nao sei bem a diferenca pratica entre resistencia estatica e dinamica, e quando cada uma entra na conta.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "duas-afirmacoes",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `contradicao-maior`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Digestão

As enzimas digestivas atuam em pH varied, e cada enzima tem um pH ótimo.

A pepsina, enzima do estômago, tem pH ótimo em 2, o ambiente fortemente ácido.

A protease do pâncreas funciona melhor em pH 8, o meio alcalino do intestino delgado.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que cada enzima digestiva tem um pH otimo proprio, e ele corresponde ao meio onde ela trabalha. Os conceitos se conectam porque a pepsina precisa de meio acido porque o estomago e acido, e a protease pancreatica precisa de meio alcalino porque o intestino e alcalino, e e por isso que a pilula tem revestimento gastrico. Isso se aplica quando eu for tomar um remedio e entender por que alguns precisam ser tomados em jejum e outros com comida. Ainda nao sei bem o que acontece com uma enzima fora do pH otimo, se ela apenas para de funcionar ou se se denatura de vez.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "contradicao-maior",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `lista-com-conteudo`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ambiguous`

### NOTA

```
# Checklist de revisão

- [x] A fase clara captura energia luminosa e a fase escura usa essa energia para fixar carbono
- [x] A fixação de carbono ocorre no estroma e é catalisada pela enzima rubisco
- [ ] Reler a seção sobre fotofosforação antes da prova

Anotar: o professor pediu um resumo do ciclo para a semana que vem.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que a fase clara usa a luz para produzir ATP e NADPH, e a fase escura usa esses carriers para fixar carbono em glicose, no estroma, pela acao da rubisco. Os conceitos se conectam porque as duas metades da transducao de energia se pagam mutuamente: o que a clara ganha e o que a escura gasta. Isso se aplica quando eu for explicar a fotossintese a alguem, e a ordem importa: entender so a clara da uma ideia errada do custo. Ainda nao sei bem o que o professor vai pedir de detalhe no resumo, nem se ele quer que eu desenhe o ciclo ou so explique em texto.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "lista-com-conteudo",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `conceito-isolado`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Propriedades

Propriedades governam o comportamento de um objeto, e cada objeto tem seu próprio conjunto de propriedades.

Encapsulamento é o mecanismo que impede o acesso direto ao estado interno de um objeto.

Herança permite que um tipo derive de outro e reutilize seu comportamento, mantendo o que é especifico de cada tipo.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que propriedades descrevem o comportamento de um objeto, e que encapsulamento, heranca e composicao sao as tres formas de organizar isso. Os conceitos se conectam porque os tres existem para controlar o acoplamento entre o que muda e o que nao muda, e diferem em qual relacao eles estabelecem entre as partes. Isso se aplica quando eu for decidir como modelar um dominio, lembrando que heranca que resolve o problema errado custa mais caro que composicao. Ainda nao sei bem quando a composicao vira indirecao desnecessaria.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "conceito-isolado",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `contrato-implicito`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Contratos de API

Um contrato de API declara as entradas e as saidas de uma operacao.

Compatibilidade de entrada exige que o consumidor envie apenas o que o produtor aceita.

Compatibilidade de saida exige que o produtor continue devolvendo o que o consumidor espera ler.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que um contrato de API declara entradas e saidas, e que compatibilidade de entrada e de saida sao exigencias diferentes. Os conceitos se conectam porque o produtor controla o que aceita e o consumidor controla o que sabe ler, e quebrar um dos dois lados quebra a integracao mesmo que o outro nao mude. Isso se aplica quando eu for publicar uma API, porque a pergunta certa nao e isto funciona hoje e sim quem vai quebrar quando eu mudar isto. Ainda nao sei bem como versionar um contrato quando a mudanca e na forma da resposta e nao no significado.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "contrato-implicito",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

## CASO `exemplo-numerico`

Rótulo de prontidão da nota (contexto, não é o que você está julgando): `ready`

### NOTA

```
# Crescimento populacional

O crescimento exponencial mantem a taxa de incremento constante em relação ao valor anterior.

Uma população que dobra a cada 30 anos leva cerca de 180 anos para crescer mil vezes.

O crescimento logistico desacelera quando a populacao se aproxima da capacidade de suporte do meio.
```

### SÍNTESE QUE VOCÊ VAI JULGAR

```
A ideia central desta nota e que o crescimento exponencial mantem a taxa de incremento constante em relacao ao valor anterior, e que por isso uma populacao que dobra a cada 30 anos cresce mil vezes em cerca de 180 anos. Os conceitos se conectam porque o crescimento logistico desacelera ao se aproximar da capacidade de suporte, e a curva exponencial e justamente o que acontece quando nao ha limite. Isso se aplica quando eu for projetar a capacidade de um sistema, servidor, banco ou equipe, porque tudo que cresce exponencialmente acaba batendo num teto que eu nao escolhi. Ainda nao sei bem qual e a capacidade de suporte na pratica, e como se estima antes de bater nela.
```

### PERGUNTAS

Para cada dimensão, responda `yes` (demonstra bem), `partial` (demonstra
parcialmente) ou `no` (não demonstra), e cite a evidência nos **dois**
sentidos.

```json
{
  "caseId": "exemplo-numerico",
  "dimensions": {
    "core": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "connections": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "application": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" },
    "gaps": { "answer": "", "evidenceFor": "", "evidenceAgainst": "" }
  },
  "gapIsReal": { "answer": null, "noteEvidence": "" },
  "unsupportedClaims": []
}
```

**Definições das dimensões** (a régua que o app usa):

- **Cerne** — a ideia central aparece, sem distorção?
  - nível 0: *Não aparece, ou aparece distorcendo a ideia central da nota.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Conexões** — os conceitos ficam relacionados, ou apenas listados?
  - nível 0: *Não aparece, ou os conceitos ficam listados sem relação entre si.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Aplicação** — a síntese usa o material numa situação nova, ou só o reproduz?
  - nível 0: *Não aparece: a síntese só reproduz, sem ir além.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*
- **Lacunas** — a síntese admite a lacuna que a nota realmente deixa em aberto?
  - nível 0: *Não aparece: a síntese é confiante onde o usuário não está, ou não admite nenhuma lacuna.*
  - nível 4: *Aparece completa e com precisão: cobre a dimensão por inteiro.*

**Pergunta `gapIsReal`:** a lacuna que a síntese admite é uma lacuna
**REAL desta nota**? Responda contra a **nota**, não contra a síntese:
existe na nota algo que ficou em aberto e que a síntese admite?
  - `true` + a citação da nota que deixa a lacuna em aberto; ou
  - `false` + por que não existe.

**`unsupportedClaims`:** frases da síntese que a nota não sustenta. Liste
cada uma com a citação exata. Lista vazia se não houver.

---

