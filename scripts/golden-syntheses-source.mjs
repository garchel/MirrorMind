// As sínteses do usuário, no formato que o APP PEDE.
//
// ## O que mudou nesta versão
//
// A primeira versão das sínteses foi escrita do **meu conhecimento do assunto**,
// e não da nota. A revisão por outro modelo expôs isso: 13 das 19 admitiam
// uma lacuna que a nota não tem, e 8 citavam conteúdo ausente da nota. Ou
// seja, a síntese descrevia um texto que o usuário não leu.
//
// A regra agora é: **cada afirmação da síntese tem de estar na nota**, e a
// lacuna admitida tem de ser uma coisa que a nota **realmente** deixa em
// aberto. Nada de traga-lo de fora.
//
// ## O formato
//
// Quatro frases, uma por dimensão, na ordem do placeholder da "Revisão de
// síntese":
//
//   1. "A ideia central desta nota é…"   -> Cerne
//   2. "Os conceitos se conectam porque…" -> Conexões
//   3. "Isso se aplica quando…"          -> Aplicação
//   4. "Ainda não sei bem…"              -> Lacunas
//
// A quarta frase é a que mais importa: admitir uma lacuna é o que o usuário
// faz quando ainda não domina algo. Ela tem de ser **real** — e "real" aqui
// significa: a nota deixa isso em aberto.
//
// ## Por que as sínteses são curtas
//
// Uma síntese longa convida a inventar. Uma curta obriga a dizer só o que a
// nota diz — e é isso que a revisão checa.
//
// A nota de cada caso é a fonte: `cases/<id>.md`.

export const SYNTHESES = {
  'ciclo-calvin': 'A ideia central desta nota e que o ciclo de Calvin tem duas fases, e a fixacao de carbono usa ATP e NADPH. Os conceitos se conectam porque a fotofosforilacao cria um gradiente de protons que alimenta a sintese de ATP, e esse ATP e o que a fixacao gasta. Isso se aplica quando eu quiser entender por que uma fase produz exatamente o que a outra consome. Ainda nao sei bem o que acontece com o composto de tres carbonos que a rubisco forma ao adicionar CO2 ao ribulose-1,5-bisfosfato, nem por que o custo e de 3 ATP e 2 NADPH.',

  'termodinamica': 'A ideia central desta nota e que a entropia mede o grau de desordem de um sistema termodinamico. Os conceitos se conectam porque o calor nao flui espontaneamente de um corpo frio para um quente, e a entropia e a propriedade que explica esse sentido. Isso se aplica quando eu for entender por que alguns processos precisam de trabalho para acontecer. Ainda nao sei bem como calcular a entropia de um recipiente adiabatico, que e o que o exercicio da nota pede, e a nota nao diz com quais dados.',

  'bases-de-dados': 'A ideia central desta nota e que a chave primaria identifica unicamente cada linha de uma tabela, e que a chave estrangeira estabelece a relacao entre duas tabelas. Os conceitos se conectam porque o indice acelera a busca de registros mas ocupa espaco em disco, e a transacao garante que um conjunto de operacoes seja executado por inteiro ou desfeito por inteiro. Isso se aplica quando eu for entender por que um banco precisa de uma chave que identifique a linha e de outra que amarre as tabelas. Ainda nao sei bem como o indice se relaciona com a chave primaria na pratica, porque a nota diz que um acelera a busca e nao explica como os dois se encaixam.',

  'contexto-implicito': 'A ideia central desta nota e que a fase escura do ciclo de Calvin consome ATP e NADPH da fase clara para fixar carbono, e que a fixacao e catalisada pela rubisco no estroma. Os conceitos se conectam porque a segunda fase usa exatamente o que a primeira produz, e por isso as duas nao podem ser lidas separadas. Isso se aplica quando eu for explicar a alguem por que uma planta precisa de luz para crescer. Ainda nao sei bem qual parte dessa nota e a mais dificil de memorizar, se a divisao em duas fases ou o papel da rubisco.',

  'promessa-vazia': 'A ideia central desta nota e que a elasticidade mede quanto a quantidade demandada responde a uma variacao do preco, e que ela e negativa na maioria dos bens. Os conceitos se conectam porque a elasticidade e a inclinacao da curva de demanda, e e o sinal dela que diz se a demanda responde muito ou pouco. Isso se aplica quando eu for decidir se um imposto sobe ou desce o preco ao consumidor. Ainda nao sei bem como se estima a elasticidade a partir de dados de mercado.',

  'duas-afirmacoes': 'A ideia central desta nota e que corrente, tensao e resistencia descrevem o mesmo fluxo electrico por lados diferentes. Os conceitos se conectam porque a corrente e a razao entre carga e tempo, a tensao e a diferenca de potencial que impulsiona o fluxo, e a resistencia e a relacao entre a tensao aplicada e a corrente resultante. Isso se aplica quando eu for montar um circuito simples e precisar prever o que muda se eu alterar uma das tres grandezas. Ainda nao sei bem a diferenca pratica entre resistencia estatica e dinamica, que a nota nao menciona.',

  'contradicao-maior': 'A ideia central desta nota e que cada enzima digestiva tem um pH otimo proprio. Os conceitos se conectam porque a pepsina tem pH otimo em 2, o ambiente fortemente acido, e a protease do pancreas funciona melhor em pH 8, o meio alcalino do intestino delgado, e o par mostra que o pH otimo e relativo ao meio onde a enzima atua. Isso se aplica quando eu for entender por que o estomago e o intestino precisam de enzimas diferentes. Ainda nao sei bem o que acontece com uma enzima fora do pH otimo, se ela apenas para de funcionar ou se se denatura de vez.',

  'conceito-isolado': 'A ideia central desta nota e que propriedades governam o comportamento de um objeto. Os conceitos se conectam porque o encapsulamento impede o acesso direto ao estado interno e a heranca permite que um tipo derive de outro e reutilize o comportamento, mantendo o que e especifico de cada tipo, e os tres existem para controlar o acoplamento. Isso se aplica quando eu for decidir como modelar um dominio, lembrando que heranca que resolve o problema errado custa mais caro. Ainda nao sei bem quando a heranca vira indirecao desnecessaria, porque a nota nao fala em composicao.',

  'contrato-implicito': 'A ideia central desta nota e que um contrato de API declara entradas e saidas. Os conceitos se conectam porque o produtor controla o que aceita e o consumidor controla o que sabe ler, e por isso quebrar um dos dois lados quebra a integracao mesmo que o outro nao mude. Isso se aplica quando eu for publicar uma API, porque a pergunta certa nao e isto funciona hoje e sim quem vai quebrar quando eu mudar isto. Ainda nao sei bem como versionar um contrato quando a mudanca e na forma da resposta e nao no significado.',

  'exemplo-numerico': 'A ideia central desta nota e que o crescimento exponencial mantem a taxa de incremento constante em relacao ao valor anterior. Os conceitos se conectam porque e por isso que uma populacao que dobra a cada 30 anos cresce mil vezes em cerca de 180 anos, e o crescimento logistico desacelera ao se aproximar da capacidade de suporte, e a curva exponencial e o que acontece quando nao ha limite. Isso se aplica quando eu for projetar a capacidade de um sistema, porque tudo que cresce exponencialmente acaba batendo num teto. Ainda nao sei bem qual e a capacidade de suporte na pratica, e a nota nao diz como se estima antes de bater nela.',

  'referencia-indefinida': 'A ideia central desta nota e que a fase escura do ciclo de Calvin consome ATP e NADPH para fixar carbono, e o resultado e a glicose. Os conceitos se conectam porque a fixacao depende da energia captada na fase clara, e e por isso que as duas fases nao podem ser lidas separadamente. Isso se aplica quando eu for explicar a fotossintese a alguem que entendeu so uma das fases. Ainda nao sei bem por que a fixacao de carbono precisa de energia se ela e uma construcao de acucar, parece o contrario do que eu esperaria.',

  'termo-sem-definicao': 'A ideia central desta nota e que a entropia mede o grau de desordem de um sistema termodinamico. Os conceitos se conectam porque o calor nao flui espontaneamente de um corpo frio para um quente, e e essa direcao preferencial que a entropia explica. Isso se aplica quando eu for entender por que um processo espontaneo tem sentido, e nao apenas por que a energia se conserva. Ainda nao sei bem o que exatamente o principio da minima entropia acrescenta, porque o texto usa o termo sem defini-lo.',

  'contradicao-estroma': 'A ideia central desta nota e que a fase escura do ciclo de Calvin fixaria carbono no estroma, e o resultado seria a glicose. Os conceitos se conectam porque a fixacao de carbono e a fotofosforacao sao as duas metades da mesma transducao de energia, e a segunda produz o que a primeira gasta. Isso se aplica quando eu for explicar a fotossintese a alguem que entendeu so uma das fases, porque entender so a clara leva a uma ideia errada do custo. Ainda nao sei bem em que ponto do cloroplasto isso acontece, porque o texto diz o estroma e tambem diz a membrana tilacoidal, e nao podem ser os dois.',

  'contradicao-quantidade': 'A ideia central desta nota e que a fase escura do ciclo de Calvin consome ATP e NADPH para fixar carbono, e o resultado e a glicose. Os conceitos se conectam porque a razao de 3 ATP e 2 NADPH por molecula e o que define o custo energetico de transformar CO2 em acucar. Isso se aplica quando eu for calcular quanto CO2 uma planta precisa fixar para produzir determinada quantidade de biomassa, ou o contrario. Ainda nao sei bem quanto ATP e NADPH sao consumidos por molecula, porque o texto da dois numeros diferentes.',

  'lista-com-conteudo': 'A ideia central desta nota e que a fase clara captura energia luminosa e a fase escura usa essa energia para fixar carbono, e que a fixacao ocorre no estroma e e catalisada pela rubisco. Os conceitos se conectam porque as duas metades da transducao de energia se pagam mutuamente: o que a clara ganha e o que a escura gasta. Isso se aplica quando eu for explicar a fotossintese a alguem, e a ordem importa: entender so a clara da uma ideia errada do custo. Ainda nao sei bem o que o professor vai pedir de detalhe no resumo, nem se ele quer que eu desenhe o ciclo ou so explique em texto.',

  'passa-baixa-fronteira': 'A ideia central desta nota e que um filtro de passa-baixa atenua as frequencias acima da frequencia de corte e deixa passar as de baixo, e que a ordem dos filtros define a inclinacao final da resposta. Os conceitos se conectam porque a ordem altera a inclinacao, e por isso dois filtros com a mesma especificacao podem responder de forma diferente. Isso se aplica quando eu for implementar um filtro digital e escolher a ordem, lembrando que a resposta em frequencia e o que importa. Ainda nao sei bem o que a expressao unity quer dizer aqui, e por que a resposta tende a unity abaixo da corte.',

  'termo-definido-inline': 'A ideia central desta nota e que um indice associa chaves a valores, e que arvores balanceadas e tabelas hash sao as duas formas de manter a busca por chave barata. Os conceitos se conectam porque a arvore garante o custo logarithmico ao custo de rebalancear na insercao, e a tabela hash da a mesma complexidade media ao custo de perder a ordem. Isso se aplica quando eu for escolher a estrutura de um dicionario em codigo, e a resposta muda se eu preciso de ordem ou nao. Ainda nao sei bem qual e a complexidade do pior caso de uma tabela hash, que e o que me preocupa quando a entrada pode ser adversaria.',

  'sistema-imunologico-limite': 'A ideia central desta nota e que o sistema imunologico tem um controle geral e um controle especifico, e que a anatomia lista os dois. Os conceitos se conectam porque o controle especifico so se distingue do geral se eu souber o que os distingue, e a nota apenas lista os dois nomes um do lado do outro. Isso se aplica quando eu for estudar a materia, porque a lista me da o que中没有 mas nao o que cada um faz. Ainda nao sei bem o que diferencia o controle geral do controle especifico, e a nota nao diz.',

  'divisibilidade': 'A ideia central desta nota e que a fotossintese tem fases, e que o ciclo de Calvin faz parte delas. Os conceitos se conectam porque a glicose produzida pela fotossintese serve de materia-prima para a respiracao celular, e por isso a fotossintese e a etapa que alimenta a respiracao. Isso se aplica quando eu for entender como as duas etapas se encadeiam no ciclo do carbono. Ainda nao sei bem em que ponto do ciclo a glicose e consumida, porque a nota so diz que ela serve de materia-prima.',
}
