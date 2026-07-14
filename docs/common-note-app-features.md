# Common Features de Aplicativos de Notas

Este documento organiza funcionalidades comuns de aplicativos como Obsidian, Notion, Apple Notes e Logseq, indicando o estado atual no MirrorMind.

Legenda:

- Implementado: funcionalidade utilizavel na versao atual.
- Parcial: existe uma base, mas faltam partes importantes.
- Planejado: ainda nao foi implementado.

## Bloco 1: Vault e arquivos

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Abrir vault local existente | Implementado | Abre pastas reais do computador. |
| Criar vault local | Implementado | Cria a estrutura `.mirmind/`. |
| Compatibilidade com vault Obsidian | Implementado | Le arquivos `.md` e detecta `.obsidian/`. |
| Reabrir ultimo vault | Implementado | Pergunta antes de reabrir ou pode abrir automaticamente. |
| Navegacao por pastas | Implementado | Arvore de arquivos com pastas abertas e fechadas. |
| Criar pasta | Implementado | Cria pastas reais no vault pelo explorador. |
| Renomear arquivos e pastas | Implementado | Renomeia notas e pastas reais pelo explorador, preservando abas abertas. |
| Mover arquivos e pastas | Implementado | Move notas e pastas entre diretorios reais do vault, preservando abas abertas. |
| Excluir com lixeira | Implementado | Move itens para `.mirmind/trash` e permite restaurar ao local original. |

## Bloco 2: Editor Markdown

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Criar nota | Implementado | Abre uma aba temporaria com foco no titulo; `Enter` cria a nota. |
| Editar Markdown | Implementado | Edicao de texto direta em arquivos `.md`. |
| Salvar nota | Implementado | Salva no arquivo real do vault. |
| Auto Save | Implementado | Configuravel na pagina de Configuracoes. |
| Abas de notas | Implementado | Abre, seleciona e fecha abas. |
| Rascunhos por aba | Implementado | Mantem rascunhos durante a sessao. |
| Preview renderizado de Markdown | Implementado | Modos Edicao, Leitura e Misto. |
| Toolbar de formatacao | Implementado | Titulos, texto, listas, citacao, links, codigo e divisores no modo Edicao. |
| Anexos e imagens | Implementado | Copia arquivos para `attachments/` espelhando a pasta da nota, insere links Markdown e renderiza imagens locais. |
| Links internos e backlinks | Implementado | Insere links `[[nota]]`, permite navegacao e exibe referencias recebidas. |
| Tags | Implementado | Insere `#tags`, mostra etiquetas da nota e filtra o explorador. |

## Bloco 3: Busca e navegacao

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Busca rapida de notas | Implementado | Atalho configuravel abre uma busca no topo do workspace. |
| Filtro por nome de nota | Implementado | Busca no titulo e caminho enquanto o usuario digita. |
| Busca por conteudo | Implementado | Pesquisa titulo, caminho, texto e tags, com trecho correspondente. |
| Busca por tags | Implementado | Filtro com selecao multipla de tags, dropdown e atalho configuravel. |
| Favoritos e notas fixadas | Implementado | Persistidos em `.mirmind/config.json` e exibidos no topo do explorador. |

## Bloco 4: Produtividade

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Atalhos configuraveis | Implementado | Nova nota, abrir nota, filtro de tags e Command Palette. |
| Desfazer e refazer | Implementado | Historico de criacao e salvamento, com controles no editor. |
| Historico persistente | Implementado | Armazenado em `.mirmind/history.json`. |
| Builder Mode | Implementado | Exibe nomes amigaveis das areas da interface. |
| Command palette | Implementado | Atalho configuravel abre comandos pesquisaveis do workspace. |
| Templates de nota | Implementado | Modelos Em branco, Nota de estudo e Reuniao em `.mirmind/templates.json`. |

## Bloco 7: Roadmap do Editor Obsidian

Estas tasks acompanham a evolucao do editor atual para uma experiencia compativel com o editor Markdown do Obsidian. O status deve ser atualizado a cada entrega.

**Regra obrigatoria para todas as tasks deste bloco:** toda funcionalidade de edicao deve ser implementada e testada nos modos **Edicao** e **Misto**. Os dois modos compartilham o mesmo comportamento, atalhos, cursor, selecao, historico e salvamento. A unica diferenca permitida e visual: no modo Misto, somente o bloco em foco exibe o Markdown editavel; os demais blocos mostram o resultado renderizado.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Migrar o editor para CodeMirror 6 | Implementado | Os modos Edicao e Misto usam CodeMirror, preservam documento, cursor, selecao, rolagem e historico por nota/bloco e destacam Markdown e linguagens de blocos de codigo. |
| Historico de texto por nota | Implementado | Cada nota aberta preserva seu proprio historico de desfazer/refazer, texto, cursor e selecao nos modos Edicao e Misto. |
| Autosave com debounce | Implementado | Salva apos 650 ms de pausa, preserva foco/cursor nos modos Edicao e Misto e mantem edicoes feitas durante uma gravacao para o proximo ciclo. |
| Live Preview por bloco | Implementado | No modo Misto, somente o bloco em foco mostra Markdown editavel; os demais ficam renderizados. |
| Markdown completo | Implementado | Titulos, listas/checklists aninhadas, citacoes, links, codigo com realce por linguagem, anexos/imagens, divisores e tabelas GFM com navegacao e controles de linhas/colunas funcionam nos modos Edicao e Misto. |
| Frontmatter YAML | Implementado | Editor YAML completo no cabecalho, com validacao e preservacao de valores, listas, objetos e estruturas aninhadas. |
| Atalhos de edicao | Implementado | `Ctrl+B` e `Ctrl+I` alternam negrito/italico; `Ctrl+Shift+8`, `Ctrl+Shift+7` e `Ctrl+Shift+9` alternam listas, listas numeradas e checklists. `Tab`, `Shift+Tab` e `Enter` cuidam de recuo, navegacao de tabelas, continuidade e saida de blocos. |
| Autocomplete contextual | Implementado | Sugestoes filtradas para `[[links]]`, `#tags`, embeds `![[attachments/...]]` e comandos iniciados com `/`, nos modos Edicao e Misto. |
| Busca e substituicao na nota | Implementado | `Ctrl+F` e o botao de busca abrem o painel nativo do CodeMirror para localizar, navegar e substituir texto. No modo Misto, a busca abre a nota inteira em Edicao. |
| Operacoes de linhas e blocos | Implementado | Atalhos nativos do CodeMirror: `Alt+Seta` move, `Shift+Alt+Seta` duplica, `Alt+L` seleciona e `Ctrl+Shift+K` exclui as linhas selecionadas. |
| Drag and drop no editor | Implementado | Arquivos soltos no painel pelo evento nativo do Tauri sao copiados para `attachments/` e inseridos como Markdown; texto continua aceito pelo CodeMirror. |
| Integridade de links | Implementado | Renomear ou mover notas atualiza links internos por caminho, preservando aliases e headings. A nota aberta tambem sinaliza links wiki que nao resolvem para um arquivo Markdown do Vault. |
| Preview de links internos | Implementado | Hover em `[[links]]` carrega um tooltip com titulo e resumo da nota vinculada; o clique continua abrindo a nota. |
| Atualizacao externa de arquivos | Implementado | A nota aberta e verificada periodicamente. Mudancas externas atualizam notas sem rascunho; com rascunho local, o usuario escolhe carregar o arquivo externo ou manter sua versao. |
| Preferencias de leitura | Implementado | Fonte, largura e quebra de linha sao configuraveis no modo Leitura; o corretor ortografico nativo pode ser ativado ou desativado nos modos Edicao e Misto. |
| Acessibilidade do editor | Implementado | Atalho para pular ao conteudo, foco visivel, abas semanticas, regioes rotuladas, alertas anunciados e rotulos explicitos para o CodeMirror nos modos Edicao e Misto. |
| Testes de regressao do editor | Implementado | A suite de workspace cobre criacao de nota, nota diaria, navegacao por links internos e autosave. A suite CodeMirror cobre cursor/selecao, historico, atalhos, busca e autocomplete de links, tags e anexos. |
| Notas diarias | Implementado | A Command Palette cria ou abre a nota do dia em `Diarias/AAAA-MM-DD.md`. |

**Lembrete apos concluir o Bloco 7:** executar `cargo fmt` em um commit exclusivo de formatacao e repetir `cargo test`.

## Bloco V2: Evolucoes Futuras

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Observacao completa do Vault | Planejado | Detecta criacoes, edicoes, renomeacoes, movimentacoes e exclusoes externas em toda a arvore do Vault, atualizando o explorador e oferecendo resolucao de conflitos para notas abertas. |

## Bloco 8: Compatibilidade com Vaults Obsidian

Objetivo: um usuario deve conseguir abrir um Vault do Obsidian, navegar e editar notas suportadas sem perda ou alteracao involuntaria de dados. Recursos nativos nao suportados devem ser preservados literalmente e sinalizados, nunca removidos ou reformatados silenciosamente.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Contrato de compatibilidade V1 | Planejado | Define sintaxes suportadas, preservadas e explicitamente fora de escopo, com exemplos de entrada e saida. |
| Suite de Vaults de compatibilidade | Planejado | Vaults de fixture reais cobrem Markdown, YAML, wikilinks, embeds, anexos, tags, callouts e nomes de arquivo complexos. |
| Preservacao sem perdas do frontmatter | Planejado | Editar uma propriedade nao remove comentarios, ordem, aspas, anchors, aliases, tags, valores desconhecidos ou estilos de YAML existentes. |
| Preservacao de Markdown nao suportado | Planejado | Callouts, blocos especiais, HTML, sintaxes de plugins e extensoes desconhecidas permanecem byte-equivalentes quando nao sao editadas. |
| Wikilinks completos | Planejado | Suporta caminhos, aliases, headings, block references e links com caracteres especiais, seguindo a resolucao do Obsidian. |
| Embeds e transclusoes | Planejado | Renderiza e edita `![[nota]]`, `![[imagem.png]]`, PDFs e recortes por heading/bloco sem quebrar o Markdown original. |
| Tags compativeis | Planejado | Indexa tags no corpo e no frontmatter, incluindo tags aninhadas, caracteres Unicode e filtros equivalentes. |
| Anexos compativeis | Planejado | Respeita caminhos relativos, nomes duplicados, extensoes e convencoes da pasta de anexos configurada no Vault. |
| Arquivos e configuracoes `.obsidian/` | Planejado | Ignora arquivos internos com seguranca e le configuracoes relevantes sem sobrescreve-las. |
| Plugins e arquivos especiais | Planejado | Preserva dados de plugins, Canvas, Excalidraw e arquivos desconhecidos; informa limitacoes de visualizacao sem modifica-los. |
| Deteccao de mudancas externas | Planejado | Atualizacoes feitas no Obsidian ou no sistema sao detectadas, com comparacao e resolucao de conflitos. |
| Renomeacao compativel | Planejado | Renomear ou mover notas atualiza apenas links reconhecidos e preserva aliases, embeds e referencias de bloco. |
| Matriz de regressao Obsidian | Planejado | Cada release executa testes de abertura, edicao e reabertura dos Vaults de fixture sem perda de dados. |

## Bloco 5: Revisao e aprendizado

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Metadados de revisao no vault | Implementado | Estrutura `.mirmind/` preparada. |
| Algoritmo de repeticao espacada | Planejado | |
| Avaliacao por IA | Planejado | |
| Identificacao de lacunas de conhecimento | Planejado | |
| Agenda de revisoes | Planejado | |
| Relatorios de retencao | Planejado | |

## Bloco 6: Configuracoes

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Auto Save | Implementado | Persistido localmente no aplicativo. |
| Atalhos | Implementado | Persistidos localmente no aplicativo. |
| Preferencia de reabrir ultimo vault | Implementado | Persistida na configuracao nativa do aplicativo. |
| Tema claro/escuro | Planejado | O tema atual e claro, inspirado em caderno. |
| Configuracao de fonte | Planejado | |
| Configuracao de historico | Planejado | Limite atual: 100 acoes. |
