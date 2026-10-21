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
muda-cor, um ícone) dependem de como o app se sente na leitura — é um teste
com os olhos, não com o código. Se preferir outro visual, é uma mudança
localizada em `src/features/dictionary/dictionary.css`.
