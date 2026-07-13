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

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Migrar o editor para CodeMirror 6 | Parcial | O modo Edicao ja usa CodeMirror com documento, cursor, selecao e rolagem por nota. O historico independente por aba entra na proxima etapa. |
| Historico de texto por nota | Planejado | `Desfazer` e `Refazer` restauram texto, cursor e selecao da nota ativa. |
| Autosave com debounce | Planejado | Salva alteracoes sem flicker, perda de foco ou chamadas concorrentes. |
| Live Preview por bloco | Planejado | A sintaxe Markdown aparece apenas no bloco em foco; os demais blocos ficam renderizados. |
| Markdown completo | Planejado | Titulos, listas, checklists, tabelas, citacoes, codigo, links, imagens e divisores funcionam no editor. |
| Frontmatter YAML | Parcial | `description` ja existe; faltam propriedades editaveis, validacao e exibicao consistente. |
| Atalhos de edicao | Planejado | Inclui negrito, italico, listas, tabulacao, continuidade de listas e saida de blocos. |
| Autocomplete contextual | Planejado | Sugestoes para `[[links]]`, `#tags`, anexos e comandos iniciados com `/`. |
| Busca e substituicao na nota | Planejado | Localiza, navega e substitui texto dentro da nota ativa. |
| Operacoes de linhas e blocos | Planejado | Duplicar, mover, selecionar e excluir linhas/blocos pelo teclado. |
| Drag and drop no editor | Planejado | Aceita texto, imagens e arquivos; converte arquivos em anexos Markdown. |
| Integridade de links | Planejado | Renomear notas atualiza links internos e identifica links quebrados. |
| Preview de links internos | Planejado | Hover em `[[links]]` mostra um resumo da nota vinculada. |
| Atualizacao externa de arquivos | Planejado | Detecta mudancas no `.md` fora do app e oferece resolucao de conflito para rascunhos. |
| Preferencias de leitura | Planejado | Fonte, largura de leitura, quebra de linha e corretor ortografico configuraveis. |
| Acessibilidade do editor | Planejado | Fluxos completos por teclado e suporte adequado a leitores de tela. |
| Testes de regressao do editor | Planejado | Cobrem edicao, autosave, cursor, atalhos, links e anexos. |
| Notas diarias | Planejado | |

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
