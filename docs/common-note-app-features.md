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

## Roadmap V2

Os blocos de features V2 e V2.1 foram movidos para [v2-features-roadmap.md](v2-features-roadmap.md).

## Roadmap de qualidade e testes

A estrategia multiplataforma, com Windows como prioridade, e o plano de E2E desktop estao em [testing-roadmap.md](testing-roadmap.md).


## Bloco 8: Compatibilidade com Vaults Obsidian

Objetivo: um usuario deve conseguir abrir um Vault do Obsidian, navegar e editar notas suportadas sem perda ou alteracao involuntaria de dados. Recursos nativos nao suportados devem ser preservados literalmente e sinalizados, nunca removidos ou reformatados silenciosamente.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Contrato de compatibilidade V1 | Implementado | O contrato em `docs/obsidian-v1-compatibility.md` define sintaxes suportadas, preservadas e fora de escopo, incluindo a regra de nunca reformatar ou remover recursos desconhecidos silenciosamente. |
| Suite de Vaults de compatibilidade | Implementado | A matriz executavel cobre dois Vaults completos de estudos e projetos, alem de uma fixture sintatica legada, com `.obsidian`, anexos, notas aninhadas, nota diaria, Canvas e dados de plugins. Frontend e backend validam indexacao, edicao, reabertura e preservacao byte a byte de conteudo desconhecido e configuracoes. Casos adicionais de CRLF, BOM, nomes Unicode e caminhos longos devem ampliar a matriz sem alterar esse contrato. |
| Preservacao sem perdas do frontmatter | Implementado | O editor YAML completo preserva literalmente a fonte valida e o editor individual altera, cria ou remove qualquer propriedade de nivel superior sem reserializar as demais. Comentarios, ordem, aspas, anchors, aliases, campos desconhecidos e finais de linha nao relacionados permanecem byte a byte; listas e objetos aninhados podem ser editados como YAML. |
| Preservacao de Markdown nao suportado | Implementado | Callouts possuem aparencia semantica, icones, cores, titulos com Markdown inline, aninhamento em blocos e listas e recolhimento `+/-`. HTML e interpretado por `rehype-raw` somente apos sanitizacao; blocos e sintaxes de plugins, comentarios Obsidian e extensoes desconhecidas permanecem literais no arquivo e recursos limitados sao sinalizados no painel. |
| Wikilinks completos | Implementado | Caminhos explicitos desde a raiz, nomes curtos relativos, duplicatas pela nota mais proxima, aliases, caracteres especiais, links locais, subheadings encadeados e referencias de bloco sao resolvidos de forma consistente na leitura, transclusao, backlinks e links quebrados. Wikilinks inexistentes criam a nota no caminho indicado. A reescrita ao renomear ou mover permanece rastreada separadamente em Renomeacao compativel. |
| Embeds e transclusoes | Implementado | Renderiza `![[nota]]` pelo mesmo pipeline Markdown seguro da nota principal, com caminhos relativos, recortes por heading ou bloco, nesting limitado e leituras IPC controladas. Imagens e PDFs locais funcionam em pastas seguras do Vault; PDFs inventariados usam visualizador interno com navegacao por paginas e limites contra uso excessivo de recursos. |
| Tags compativeis | Implementado | Indexa e filtra tags do corpo e da propriedade `tags` do frontmatter em formatos escalares, listas de bloco ou flow, aliases e sequencias YAML aninhadas. Normaliza hashtags, caminhos aninhados, BOM e Unicode NFC/NFD de forma consistente no explorador, na nota ativa, na insercao, no autocomplete e no grafo. Ignora codigo, comentarios e fragmentos de URL, rejeita tags parciais e aplica limites de seguranca ao indice. Valores YAML que nao representam tags sao preservados. |
| Anexos compativeis | Implementado | Respeita as quatro localizacoes documentadas pelo Obsidian em `attachmentFolderPath`: raiz do Vault, pasta fixa, mesma pasta da nota (`./`) e subpasta da nota (`./pasta`). Inventaria formatos suportados em todo o Vault visivel, ignora diretorios internos e symlinks, resolve caminhos de embed absolutos no Vault, relativos seguros e nomes curtos pela pasta mais proxima, com normalizacao Unicode. A importacao valida o ancestral antes de criar pastas, confirma o confinamento depois da criacao e reserva nomes atomicamente sem sobrescrever; o calculo de destino e validado contra os Vaults de estudos e projetos. Evolucoes nao bloqueantes foram movidas para Compatibilidade ampliada de anexos no bloco V2. |
| Arquivos e configuracoes `.obsidian/` | Implementado | Mantem `.obsidian` fora dos indices editaveis e nunca escreve em suas configuracoes. Le de `app.json`, por uma whitelist tipada e limitada, as preferencias de novas notas, anexos, formato e atualizacao de links, arquivos nao suportados, confirmacao/lixeira e filtros excluidos. O snapshot read-only acompanha o resumo do Vault pelo contrato IPC; configuracoes ausentes, invalidas, grandes demais ou campos de plugins sao ignorados sem impedir a abertura nem alterar bytes. |
| Plugins e arquivos especiais | Implementado | Canvas, Excalidraw, `.excalidraw.md` e formatos desconhecidos fora de diretorios internos sao inventariados por uma API read-only, permanecem fora do editor de notas e aparecem em um painel de compatibilidade com caminho e limitacao. A coleta ignora `.obsidian`, `.mirmind`, diretorios com nome iniciado por ponto e symlinks; listar ou atualizar o Vault nao le nem modifica o conteudo desses arquivos. O inventario interrompe a varredura apos detectar mais de 500 itens e avisa sobre o truncamento para manter o workspace responsivo. Dados internos de plugins e configuracoes continuam preservados sem serem expostos. |
| Deteccao de mudancas externas | Implementado | O backend Tauri observa o Vault recursivamente e emite eventos nativos relativos, ignorando `.mirmind`. O frontend agrega eventos, reconcilia a arvore, remapeia renomeacoes/movimentacoes e resolve remocoes de notas abertas por modal, com polling como fallback. |
| Renomeacao compativel | Implementado | Renomear ou mover notas e pastas resolve os wikilinks contra a arvore anterior do Vault e preserva os destinos dos links de entrada e saida, incluindo links curtos reconhecidos, caminhos de raiz, extensao explicita e embeds. Aliases, headings, referencias de bloco, espacos e finais de linha sao preservados; links em codigo inline, code fences, comentarios HTML e Obsidian, blocos HTML e links escapados permanecem literais. Rascunhos abertos sao persistidos antes da mudanca. O backend faz preflight estrito, prepara as escritas, detecta edicoes concorrentes e usa staging com backups e rollback para evitar uma atualizacao parcial previsivel. |
| Matriz de regressao Obsidian | Implementado | `npm test` e `cargo test` executam cenarios nomeados para os Vaults de estudos e projetos: abertura e indexacao seletiva, edicao pelo workspace, persistencia IPC, reabertura, reindexacao, round-trip do Markdown e preservacao byte a byte de toda a arvore inventariada, incluindo configuracoes `.obsidian`, anexos, Canvas e dados de plugins. As mensagens de falha identificam o Vault, o arquivo e a etapa da regressao. |

## Bloco 5: Revisao e aprendizado

O planejamento completo foi movido para [review-learning-roadmap.md](review-learning-roadmap.md). O documento dedicado contem as dependencias tecnicas, o escopo funcional aprovado e as evolucoes V2 e do plano pago.


## Bloco 6: Configuracoes

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Auto Save | Implementado | Persistido localmente no aplicativo. |
| Atalhos | Implementado | Persistidos localmente no aplicativo. |
| Preferencia de reabrir ultimo vault | Implementado | Persistida na configuracao nativa do aplicativo. |
