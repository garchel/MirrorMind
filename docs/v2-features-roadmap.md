# Roadmap de Features V2

Este documento concentra as evolucoes futuras que antes ficavam no roadmap principal. Features concluidas permanecem registradas para preservar o historico; itens planejados ou parciais continuam sendo o backlog da V2.

## Bloco V2: Evolucoes Futuras

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Observacao completa do Vault | Implementado | Usa eventos nativos recursivos com debounce e varredura de reconciliacao, mantendo polling de baixa frequencia como fallback. Renomeacoes pareadas remapeiam abas, rascunhos e estado do editor; notas abertas removidas podem ser restauradas, salvas como novas ou fechadas. |
| Visualizador interno de PDFs | Implementado | Renderiza PDFs embutidos em notas com PDF.js, carregamento sob demanda, navegacao por paginas e estados acessiveis de carregamento e erro. A leitura passa pelo backend autorizado, aceita somente anexos inventariados e limita tamanho, quantidade e dimensoes de renderizacao. |
| Renderizacao avancada de callouts | Implementado | Reproduz icones, cores, titulos com Markdown inline, variantes recolhiveis e callouts aninhados, inclusive dentro de listas. |
| Renderizacao segura de HTML | Implementado | Interpreta o subconjunto seguro de HTML com sanitizacao, sem executar scripts ou comprometer o isolamento local. |
| Renderizacao de blocos de plugins | Planejado | Oferece visualizacao para Dataview, Tasks e outras sintaxes de plugins sem modificar sua fonte. |
| Canvas e Excalidraw | Planejado | Detecta e oferece visualizacao/edicao apropriada para arquivos Canvas e Excalidraw. |
| Compatibilidade visual de temas e plugins | Planejado | Aplica preferencias visuais relevantes sem sobrescrever configuracoes do Obsidian. |
| Tema claro/escuro | Planejado | Permite alternar entre tema claro e escuro, com persistencia da preferencia e contraste acessivel em toda a interface. O tema atual e claro, inspirado em caderno. |
| Configuracao de fonte | Planejado | Permite escolher e persistir familia, tamanho e demais preferencias tipograficas aplicaveis ao editor e a leitura. |
| Configuracao de historico | Planejado | Permite configurar e persistir o limite do historico de desfazer/refazer por nota. O limite atual e de 100 acoes. |
| Ampliacao da matriz de regressao Obsidian | Planejado | Adiciona Vaults de fixture com arquivos Markdown em CRLF, UTF-8 com BOM, nomes com espacos, Unicode nas formas NFC e NFD e caminhos proximos aos limites suportados em Windows, Linux e macOS. Cada caso deve passar por abertura, edicao no workspace, persistencia IPC, reabertura e comparacao byte a byte das regioes e arquivos nao editados, com mensagens de falha que identifiquem o Vault, o arquivo e a etapa. Os testes tambem devem garantir confinamento de escrita no Vault diante de symlinks e segmentos malformados e preservar `.obsidian` e `.mirmind` quando nao forem o alvo da operacao. |
| Varredura unificada do Vault | Planejado | Substitui as varreduras recursivas independentes de notas, anexos e arquivos especiais por uma unica passagem compartilhada ou por um indice incremental. Mantem os limites de seguranca, a exclusao de diretorios internos e a responsividade durante reconciliacoes de Vaults grandes. |
| Diagnostico de arquivos e diretorios inacessiveis | Planejado | Registra e apresenta ao usuario falhas parciais de leitura durante a indexacao, incluindo Markdown nao UTF-8 e falhas no indice de tags. Identifica os caminhos afetados sem expor dados sensiveis, mantem disponivel a parte valida do inventario e permite tentar novamente. Uma leitura parcial nunca deve ser apresentada silenciosamente como inventario completo. |
| Divisao e carregamento sob demanda do frontend | Planejado | Separa editores, renderizadores Markdown e paginas secundarias em chunks carregados sob demanda, reduzindo o bundle inicial para eliminar o aviso de arquivos acima de 500 kB sem introduzir atrasos perceptiveis na abertura do workspace. |
| Cache e indice incremental de tags | Planejado | Calcula as tags de cada nota uma vez por versao do documento e reutiliza o resultado no explorador, autocomplete, nota ativa e grafo. Atualizacoes invalidam somente as notas afetadas, evitando reprocessar YAML repetidamente durante cada renderizacao do grafo. |
| Transacao duravel para renomeacoes | Planejado | Mantem um journal persistente e recuperavel no startup para concluir ou desfazer renomeacoes interrompidas por queda de energia ou encerramento forcado, sem deixar notas, links ou backups em estado intermediario. |
| Operacoes de filesystem resistentes a TOCTOU | Planejado | Completa a protecao atomica sem sobrescrita ja usada nas movimentacoes com handles confinados ao Vault, eliminando as janelas residuais envolvendo symlinks e troca concorrente de caminhos em Windows, Linux e macOS. Inclui fallback explicito para filesystems sem suporte a hard links. |
| Compatibilidade ampliada de anexos | Planejado | Amplia a lista de formatos para arquivos que o Obsidian apenas armazena ou delega a plugins, interpreta configuracoes futuras alem das quatro localizacoes documentadas e define como notas ainda nao salvas antecipam ou realocam anexos configurados com `./` e `./pasta`. Valida sensibilidade a maiusculas, Unicode e filesystems exoticos em uma matriz maior de Vaults, com inventario incremental e limites explicitos para Vaults com muitos anexos. |
| Compatibilidade ampliada de configuracoes `.obsidian` | Planejado | Evolui a whitelist read-only conforme novos formatos do Obsidian, ignora campos conhecidos com tipos invalidos sem descartar as demais preferencias validas e oferece diagnostico local das configuracoes ignoradas sem expor dados de plugins. Elimina a janela TOCTOU residual da leitura de `app.json` com abertura no-follow e validacao pelo mesmo handle em Windows, Linux e macOS. |
| Indice escalavel de wikilinks para renomeacao | Planejado | Evita reler e preparar toda a arvore Markdown em cada renomeacao por meio de indice incremental, limites e progresso cancelavel, mantendo a atual garantia de preflight e rollback em Vaults grandes. |
| Graph view e Bases | Parcial | O grafo de notas ja mostra wikilinks, permite zoom, pan, filtros, busca, layout de forcas, arraste de nos, persistencia de layout por Vault, grafo local e painel de detalhes. Bases continua planejado. |
| Revisao e aprendizado V2 | Planejado | O escopo de revisao de sintese, cerne, multimodalidade, IA gerenciada, custos, verificacao factual e sincronizacao esta em [review-learning-roadmap.md](review-learning-roadmap.md). |

## Bloco V2.1: Evolucao do grafo de notas

Objetivo: transformar a visualizacao de conexoes em uma ferramenta de exploracao, organizacao e manutencao do conhecimento do Vault, preservando desempenho e previsibilidade em vaults pequenos e grandes.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Acoes contextuais por no | Parcial | O painel do no permite abrir a nota, abrir em uma aba do workspace, revelar no explorador e copiar o wikilink. Ainda falta criar uma conexao diretamente pelo grafo. |
| Busca com centralizacao | Implementado | Buscar uma nota destaca, seleciona, centraliza o no correspondente e ajusta o zoom para mante-lo visivel. |
| Agrupamento por pasta | Planejado | Alterna agrupamento visual por pasta, com legenda, cor consistente por grupo e tratamento claro para notas na raiz. |
| Agrupamento por tag | Planejado | Alterna agrupamento por tag, permite escolher a tag principal quando houver varias e usa cores configuraveis persistidas por Vault. |
| Configuracao de cores | Planejado | Permite personalizar e restaurar cores de grupos por pasta e tag, com contraste adequado em nos, linhas e legenda. |
| Exportacao SVG | Planejado | Exporta a visao atual, incluindo filtros, cores, nos e conexoes, como SVG vetorial reproduzivel. |
| Exportacao PNG | Planejado | Exporta a visao atual como imagem PNG em resolucao configuravel, sem depender de servico externo. |
| Modo notas nao conectadas | Parcial | Filtra e lista notas sem links de entrada ou saida, com acao para abri-las. Ainda falta revelar no explorador e iniciar a criacao de conexoes pela lista. |
| Criacao assistida de conexoes | Planejado | A partir do grafo ou da lista de notas isoladas, insere um wikilink valido na nota de origem selecionada, respeitando rascunho, autosave e conflito externo. |
| Grafo local por profundidade | Planejado | Permite escolher profundidade de 1, 2 ou 3 saltos a partir da nota central e informa quando o resultado foi limitado. |
| Carregamento em lotes | Planejado | Para vaults grandes, le notas em lotes com progresso e cancelamento ao trocar de Vault ou fechar o grafo. |
| Layout em worker | Planejado | Executa o calculo de forcas fora da thread de interface, permite cancelar/reiniciar o calculo e mantem a tela responsiva. |
| Renderizacao seletiva | Planejado | Renderiza apenas nos e linhas dentro ou proximos ao viewport, com limite configuravel e aviso quando o resultado for resumido. |
| Testes de regressao do grafo | Planejado | Cobre acoes por no, filtros, agrupamento, persistencia, exportacao, notas isoladas, profundidade e comportamento com vaults grandes. |

## Bloco V2.2: Qualidade e testes multiplataforma

Objetivo: ampliar a garantia de qualidade para macOS e Ubuntu depois que contrato IPC, artefato, E2E e gate de release Windows estiverem estabilizados. O historico implementado e o backlog prioritario Windows permanecem em [testing-roadmap.md](testing-roadmap.md).

### Compatibilidade macOS

**Objetivo:** manter macOS como segunda plataforma oficialmente suportada.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Job macOS por PR | Planejado | `macos-latest` executa testes Rust, testes frontend e build desktop; falhas bloqueiam release, mesmo que a politica de branch permita execucao E2E menos frequente por custo. |
| Filesystem macOS | Planejado | Cobre Unicode NFC/NFD, comportamento case-insensitive do volume padrao, symlinks, watchers e operacoes atomicas. |
| E2E macOS | Planejado | Jornadas criticas rodam com o driver embedded em agenda noturna e em toda release candidata; um smoke menor pode rodar em PRs. |
| Arquiteturas Apple | Planejado | Apple Silicon e Intel sao construidos e validados conforme as arquiteturas declaradas como suportadas. |

### Compatibilidade Ubuntu

**Objetivo:** preservar Ubuntu como terceira plataforma sem reduzir a prioridade dos gates Windows.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| CI Linux enxuta | Implementado | Ubuntu ja executa lint, typecheck, Vitest, build e testes Rust para feedback rapido. A task permanece registrada para preservar o historico do roadmap original. |
| Filesystem Linux | Planejado | Cobre case sensitivity, permissoes Unix, symlinks e watchers. |
| E2E Linux | Planejado | Smoke desktop roda com display virtual em agenda noturna e antes de releases multiplataforma. |

### Gates multiplataforma futuros

| Evento | macOS | Ubuntu |
| --- | --- | --- |
| Pull request | Testes e build; smoke E2E quando estabilizado. | Lint, typecheck, Vitest, build e Rust. |
| Nightly | E2E completo. | E2E completo. |
| Release candidata | CI verde e E2E de release. | CI verde se a release oferecer Linux. |

### Ordem futura

1. Adicionar o job macOS por PR.
2. Cobrir filesystem macOS e estabilizar o smoke E2E.
3. Validar Apple Silicon e Intel conforme o suporte declarado.
4. Completar filesystem Linux.
5. Adicionar smoke E2E Linux com display virtual.
