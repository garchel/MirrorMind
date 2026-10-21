# Revisão do ground truth de "melhorar a nota"

Cada bloco é uma nota. A pergunta **não** é se a nota está pronta para
revisão — é **que termo, definido, melhoraria esta nota**.

Responda com a lista dos termos que a nota usa como premissa **sem nunca
definir**, e que seriam uteis definir. Se a nota não tem nenhum, a
lista é vazia.

**Cite a frase da nota** onde o termo aparece, para que a medição possa
verificar a âncora.

Uma nota pode não ter nenhum termo assim — e isso é uma resposta
perfeitamente válida, não uma falha.

```json
{
  "caseId": "ciclo-calvin",
  "terms": [
    { "term": "rubisco", "sourceQuote": "a enzima rubisco, que adiciona CO2" }
  ]
}
```

---

## CASO `ciclo-calvin`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `somente-titulos`

Rótulo de prontidão (contexto, não é o que você está julgando): `insufficient`

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
  "terms": []
}
```

---

## CASO `contradicao-fotossintese`

Rótulo de prontidão (contexto, não é o que você está julgando): `ambiguous`

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
  "terms": []
}
```

---

## CASO `termodinamica`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `bases-de-dados`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `sistema-imunologico-limite`

Rótulo de prontidão (contexto, não é o que você está julgando): `insufficient`

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
  "terms": []
}
```

---

## CASO `contradicao-estroma`

Rótulo de prontidão (contexto, não é o que você está julgando): `ambiguous`

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
  "terms": []
}
```

---

## CASO `referencia-indefinida`

Rótulo de prontidão (contexto, não é o que você está julgando): `ambiguous`

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
  "terms": []
}
```

---

## CASO `passa-baixa-fronteira`

Rótulo de prontidão (contexto, não é o que você está julgando): `ambiguous`

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
  "terms": []
}
```

---

## CASO `termo-definido-inline`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `somente-listas`

Rótulo de prontidão (contexto, não é o que você está julgando): `insufficient`

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
  "terms": []
}
```

---

## CASO `contexto-implicito`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `contradicao-quantidade`

Rótulo de prontidão (contexto, não é o que você está julgando): `ambiguous`

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
  "terms": []
}
```

---

## CASO `promessa-vazia`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `termo-sem-definicao`

Rótulo de prontidão (contexto, não é o que você está julgando): `ambiguous`

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
  "terms": []
}
```

---

## CASO `duas-afirmacoes`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `contradicao-maior`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `sem-sujeito`

Rótulo de prontidão (contexto, não é o que você está julgando): `insufficient`

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
  "terms": []
}
```

---

## CASO `apenas-imagens`

Rótulo de prontidão (contexto, não é o que você está julgando): `insufficient`

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
  "terms": []
}
```

---

## CASO `lista-com-conteudo`

Rótulo de prontidão (contexto, não é o que você está julgando): `insufficient`

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
  "terms": []
}
```

---

## CASO `conceito-isolado`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `contrato-implicito`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

## CASO `exemplo-numerico`

Rótulo de prontidão (contexto, não é o que você está julgando): `ready`

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
  "terms": []
}
```

---

