# O dicionário de conceitos

Uma página onde você registra palavras e o que elas significam. Depois,
passar o mouse sobre a palavra em qualquer nota do Vault mostra a definição.

O propósito é concreto: uma definição escrita uma vez não precisa estar
escrita em todas as notas que falam do assunto.

## Como usar

1. Abra o **Dicionário** (botão no trilho lateral, entre "Metas" e "Painel").
2. Clique em **Novo conceito**.
3. Escreva o **termo** e o **conceito**.
4. Salve.

Pronto. A partir daí, ao passar o mouse sobre o termo em qualquer nota do
Vault, o conceito aparece acima da palavra.

Para corrigir um conceito, clique no ícone de lápis ao lado dele. Para
remover, use a lixeira.

## O atalho: "Melhorar a nota"

A feature "Melhorar a nota" (no menu de avaliação da nota, ao lado de
"Avaliar estrutura") sugere as definições que estão faltando. O botão
**Adicionar ao dicionário** abre um modal com esses termos, e cada definição
vem **editável**: você aceita, corrige ou reescreve antes de gravar.

Vale a pena porque o conceito depende do assunto: "rubisco" na biologia e
na física não é a mesma coisa. Por isso o modal deixa você reescrever — o
que você aceita vale mais do que o que o modelo propôs.

Depois de registrado, o termo passa a ter o balão de conceito no hover de
**qualquer** nota do Vault. Não precisa reescrever a definição em cada nota
que falar do assunto.

## Selecionar um trecho e pedir o conceito

Selecione uma palavra ou uma frase curta na nota e use **Adicionar seleção ao
dicionário** na barra que aparece sobre a seleção. O modal abre com o **termo
já preenchido com o que você selecionou** e, enquanto a IA escreve a definição,
mostra **"Preparando o conceito…"**, o tempo decorrido e um esqueleto no lugar
da definição. Nessa espera o termo já pode ser editado.

A IA responde com duas coisas:

- **Conceito** — a definição do termo, escrita para valer fora desta nota. É o
  que vai para o dicionário e aparece no hover.
- **Nesta nota** — o papel do termo no trecho e na nota. Fica só na tela, para
  você conferir; **não** é salvo.

Ela lê o trecho e os parágrafos ao redor (não o Vault inteiro). O termo continua
sendo o que você selecionou, com a grafia da nota, e tanto ele quanto o conceito
ficam editáveis: se a definição não servir, corrija ou peça de novo antes de
gravar.

## Onde fica guardado

`.mirmind/dictionary.json`, dentro do Vault. O dicionário é **por Vault**:
o conceito de "rubisco" na biologia não é o conceito de "rubisco" na física,
e um dicionário global mostraria a definição errada com a confiança de quem
não sabe.

## O que casa com o que

- **Caixa e acentos não importam.** "Glicólise" encontra "glicolise".
- **A palavra precisa ser a mesma.** "arte" não marca "partido".

A busca da página usa a mesma regra do hover, então o que você vê na busca é
exatamente o que o hover encontra.

## O que está em aberto

A **diferenciação visual** das palavras registradas. Hoje é um sublinhado
pontilhado, e o significado vem do hover. As alternativas (cor de fundo,
muda-cor, um ícone) dependem de como o app se sente na leitura - é um teste
com os olhos, não com o código. Se preferir outro visual, é uma mudança
localizada em `src/features/dictionary/dictionary.css`.
