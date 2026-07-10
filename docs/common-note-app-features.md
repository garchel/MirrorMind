# Common Features de Aplicativos de Notas

Este documento organiza funcionalidades comuns de aplicativos como Obsidian, Notion, Apple Notes e Logseq, indicando o estado atual no MirrorMind.

Legenda:

- Implementado: funcionalidade utilizavel na versao atual.
- Parcial: existe uma base, mas faltam partes importantes.
- Planejado: ainda nao foi implementado.

## Vault e arquivos

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Abrir vault local existente | Implementado | Abre pastas reais do computador. |
| Criar vault local | Implementado | Cria a estrutura `.mirmind/`. |
| Compatibilidade com vault Obsidian | Implementado | Le arquivos `.md` e detecta `.obsidian/`. |
| Reabrir ultimo vault | Implementado | Pergunta antes de reabrir ou pode abrir automaticamente. |
| Navegacao por pastas | Implementado | Arvore de arquivos com pastas abertas e fechadas. |
| Criar pasta | Parcial | O botao existe no explorador; a criacao real ainda precisa ser implementada. |
| Renomear arquivos e pastas | Planejado | |
| Mover arquivos e pastas | Planejado | |
| Excluir com lixeira | Planejado | |

## Edicao de notas

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Criar nota | Implementado | Abre uma aba temporaria com foco no titulo. |
| Editar Markdown | Implementado | Edicao de texto direta em arquivos `.md`. |
| Salvar nota | Implementado | Salva no arquivo real do vault. |
| Auto Save | Implementado | Configuravel na pagina de Configuracoes. |
| Abas de notas | Implementado | Abre, seleciona e fecha abas. |
| Rascunhos por aba | Implementado | Mantem rascunhos durante a sessao. |
| Preview renderizado de Markdown | Planejado | Atualmente a nota e editada como texto Markdown. |
| Toolbar de formatacao | Planejado | |
| Anexos e imagens | Planejado | |
| Links internos e backlinks | Planejado | |
| Tags | Planejado | |

## Busca e navegacao

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Busca rapida de notas | Implementado | Atalho configuravel abre uma busca no topo do workspace. |
| Filtro por nome de nota | Implementado | Resultados aparecem enquanto o usuario digita. |
| Busca por conteudo | Planejado | |
| Busca por tags | Planejado | |
| Favoritos e notas fixadas | Planejado | |

## Produtividade

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Atalhos configuraveis | Implementado | Criar nota e abrir nota existente. |
| Desfazer e refazer | Implementado | Cria e reverte historico de criacao e salvamento. |
| Historico persistente | Implementado | Armazenado em `.mirmind/history.json`. |
| Builder Mode | Implementado | Exibe nomes amigaveis das areas da interface. |
| Command palette | Planejado | |
| Templates de nota | Planejado | |
| Notas diarias | Planejado | |

## Revisao e aprendizado

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Metadados de revisao no vault | Implementado | Estrutura `.mirmind/` preparada. |
| Algoritmo de repeticao espacada | Planejado | |
| Avaliacao por IA | Planejado | |
| Identificacao de lacunas de conhecimento | Planejado | |
| Agenda de revisoes | Planejado | |
| Relatorios de retencao | Planejado | |

## Configuracoes

| Funcionalidade | Estado | Observacao |
| --- | --- | --- |
| Auto Save | Implementado | Persistido localmente no aplicativo. |
| Atalhos | Implementado | Persistidos localmente no aplicativo. |
| Preferencia de reabrir ultimo vault | Implementado | Persistida na configuracao nativa do aplicativo. |
| Tema claro/escuro | Planejado | O tema atual e claro, inspirado em caderno. |
| Configuracao de fonte | Planejado | |
| Configuracao de historico | Planejado | Limite atual: 100 acoes. |
