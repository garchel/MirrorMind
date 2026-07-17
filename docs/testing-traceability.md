# Matriz de Rastreabilidade de Testes

Este catalogo atribui um identificador estavel a cada uma das 65 features marcadas como implementadas em `common-note-app-features.md` e registra a evidencia automatizada existente. Ele descreve a cobertura atual; nao substitui os criterios funcionais do roadmap.

## Legenda

- **Direta:** pelo menos um teste executa o comportamento principal da feature e faz assercao sobre o resultado.
- **Indireta:** helpers, camadas ou partes da feature sao testados, mas a jornada ou persistencia completa nao e exercitada.
- **Lacuna:** nao foi encontrada regressao automatizada significativa para o comportamento declarado.

## Fontes de evidencia

| Codigo | Suite |
| --- | --- |
| `APP` | [`src/App.regression.test.tsx`](../src/App.regression.test.tsx) |
| `CM` | [`src/components/MarkdownCodeEditor.test.tsx`](../src/components/MarkdownCodeEditor.test.tsx) |
| `EMBED` | [`src/components/ObsidianNoteEmbed.test.tsx`](../src/components/ObsidianNoteEmbed.test.tsx) |
| `PDF` | [`src/components/ObsidianPdfEmbed.test.tsx`](../src/components/ObsidianPdfEmbed.test.tsx) |
| `MD` | [`src/lib/markdown.test.ts`](../src/lib/markdown.test.ts) |
| `VAULT` | [`src/lib/vault.test.ts`](../src/lib/vault.test.ts) |
| `CALLOUT` | [`src/lib/remarkObsidianCallouts.test.ts`](../src/lib/remarkObsidianCallouts.test.ts) |
| `FIXTURE` | [`src/fixtures/obsidian-vault/compatibility.test.ts`](../src/fixtures/obsidian-vault/compatibility.test.ts) |
| `MATRIX-FE` | [`src/fixtures/obsidian-vaults/compatibility-matrix.test.ts`](../src/fixtures/obsidian-vaults/compatibility-matrix.test.ts) |
| `RUST` | Testes do modulo em [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) |

## Bloco 1: Vault e arquivos

| ID | Feature | Cobertura | Evidencia atual | Limite conhecido |
| --- | --- | --- | --- | --- |
| `QA-B1-01` | Abrir vault local existente | Direta | `RUST`: abertura das fixtures Obsidian e inspecao do Vault | Nao abre o seletor nativo no app real. |
| `QA-B1-02` | Criar vault local | Direta | `RUST` + `E2E-WIN`: validacao segura, criacao pela interface e reabertura em novo processo | Coberto no Windows; falta ampliar a matriz desktop. |
| `QA-B1-03` | Compatibilidade com vault Obsidian | Direta | `FIXTURE`, `MATRIX-FE`, `RUST`: deteccao, indexacao e preservacao | Falta E2E do binario desktop. |
| `QA-B1-04` | Reabrir ultimo vault | Indireta | `VAULT` e `RUST`: schema e preferencia padrao | Falta alterar, reiniciar o app e confirmar a reabertura. |
| `QA-B1-05` | Navegacao por pastas | Direta | `VAULT`: arvore com pastas e pastas vazias; `RUST`: coleta real | Nao cobre todos os cliques de expandir/recolher. |
| `QA-B1-06` | Criar pasta | Indireta | `RUST`: resolucao segura e inventario de pastas | Falta acionar criacao pela interface e confirmar no disco. |
| `QA-B1-07` | Renomear arquivos e pastas | Direta | `RUST` + `E2E-WIN`: renomeacao real de nota/pasta, abas, links e reabertura | Coberto no Windows; falta ampliar a matriz desktop. |
| `QA-B1-08` | Mover arquivos e pastas | Direta | `RUST` + `E2E-WIN`: movimentos reais, destinos, links, bytes e reabertura | Coberto no Windows; falta ampliar a matriz desktop. |
| `QA-B1-09` | Excluir com lixeira | Direta | `RUST`: excluir, restaurar, remover definitivamente e retencao | Falta jornada visual completa. |

## Bloco 2: Editor Markdown

| ID | Feature | Cobertura | Evidencia atual | Limite conhecido |
| --- | --- | --- | --- | --- |
| `QA-B2-01` | Criar nota | Direta | `APP`: cria pelo titulo e por wikilink; `RUST`: nunca sobrescreve | IPC e filesystem nao estao juntos no mesmo teste. |
| `QA-B2-02` | Editar Markdown | Direta | `CM`, `APP`, `MATRIX-FE`: edicao e round-trip | Falta WebView real. |
| `QA-B2-03` | Salvar nota | Direta | `APP`: save IPC; `RUST` e fixtures: persistencia e reabertura | Frontend usa IPC mockado. |
| `QA-B2-04` | Auto Save | Direta | `APP` + `E2E-WIN`: debounce, bytes no NTFS e reabertura em novo processo | Coberto no Windows; falta ampliar a matriz desktop. |
| `QA-B2-05` | Abas de notas | Indireta | `APP`: abre e navega entre notas | Falta matriz dedicada de abrir, selecionar, fechar e restaurar varias abas. |
| `QA-B2-06` | Rascunhos por aba | Indireta | `CM`: estados por nota; `APP`: preservacao apos remocao externa | Falta troca/fechamento de varias abas com rascunhos concorrentes. |
| `QA-B2-07` | Preview renderizado de Markdown | Direta | `APP`, `MD`, `CALLOUT`, `EMBED`, `PDF`: renderizacao segura | Nao roda no WebView nativo. |
| `QA-B2-08` | Toolbar de formatacao | Indireta | `VAULT`, `MD`, `CM`: helpers e atalhos de formatacao | Falta clicar nos controles da toolbar e validar selecao/cursor. |
| `QA-B2-09` | Anexos e imagens | Direta | `RUST`: importacao e confinamento; `VAULT`/`PDF`: resolucao/renderizacao | Falta importacao pela interface no desktop real. |
| `QA-B2-10` | Links internos e backlinks | Direta | `APP`, `VAULT`, `RUST`: criacao, navegacao, resolucao e backlinks | Falta E2E desktop com arquivos reais. |
| `QA-B2-11` | Tags | Direta | `APP`, `VAULT`, `RUST`: insercao, YAML, Unicode e indice | Filtro visual completo permanece indireto em outro requisito. |

## Bloco 3: Busca e navegacao

| ID | Feature | Cobertura | Evidencia atual | Limite conhecido |
| --- | --- | --- | --- | --- |
| `QA-B3-01` | Busca rapida de notas | Lacuna | Nao ha regressao dedicada do overlay de busca rapida | Backend de busca nao prova abertura, teclado e selecao na UI. |
| `QA-B3-02` | Filtro por nome de nota | Indireta | `RUST`: busca por titulo e caminho | Falta digitar no filtro da interface e validar a arvore. |
| `QA-B3-03` | Busca por conteudo | Direta | `RUST`: titulo, caminho, conteudo e trecho correspondente | Falta jornada visual com selecao do resultado. |
| `QA-B3-04` | Busca por tags | Indireta | `VAULT` e `RUST`: extracao e indice de tags | Falta dropdown, multi-selecao, combinacoes e atalho. |
| `QA-B3-05` | Favoritos e notas fixadas | Lacuna | Nao foi encontrada regressao automatizada significativa | Falta persistencia, ordenacao e exibicao no explorador. |

## Bloco 4: Produtividade

| ID | Feature | Cobertura | Evidencia atual | Limite conhecido |
| --- | --- | --- | --- | --- |
| `QA-B4-01` | Atalhos configuraveis | Indireta | `VAULT` e `CM`: formatacao/matching e atalhos do editor | Falta configurar, persistir, reiniciar e executar atalhos globais. |
| `QA-B4-02` | Desfazer e refazer | Direta | `CM` e `RUST`: historicos independentes e reversao/reaplicacao | Falta jornada completa no desktop. |
| `QA-B4-03` | Historico persistente | Direta | `RUST`: historico real e reaplicacao de operacoes | Falta reinicio do binario na mesma jornada. |
| `QA-B4-04` | Builder Mode | Lacuna | Nao foi encontrada regressao automatizada significativa | Falta alternancia, rotulos e persistencia visual. |
| `QA-B4-05` | Command palette | Direta | `APP`: cria/abre nota diaria pela palette | Falta cobrir busca, navegacao por teclado e outros comandos. |
| `QA-B4-06` | Templates de nota | Lacuna | Nao foi encontrada regressao automatizada significativa | Falta carregar, escolher, aplicar e persistir templates. |

## Bloco 7: Roadmap do Editor Obsidian

| ID | Feature | Cobertura | Evidencia atual | Limite conhecido |
| --- | --- | --- | --- | --- |
| `QA-B7-01` | Migrar o editor para CodeMirror 6 | Direta | `CM`: documento, troca de nota, cursor e selecao | JSDOM nao reproduz integralmente o WebView. |
| `QA-B7-02` | Historico de texto por nota | Direta | `CM`: historicos separados e compartilhados no modo misto | Falta reinicio do desktop. |
| `QA-B7-03` | Autosave com debounce | Direta | `APP` + `E2E-WIN`: teste temporal e persistencia real antes do reinicio | Coberto no Windows; falta ampliar a matriz desktop. |
| `QA-B7-04` | Live Preview por bloco | Indireta | `VAULT`: divisao em blocos; `CM`: remount do bloco misto | Falta validar foco e alternancia visual de varios blocos renderizados. |
| `QA-B7-05` | Markdown completo | Direta | `MD`, `CM`, `APP`: tabelas, listas, links, codigo e callouts | Falta matriz visual em WebView real. |
| `QA-B7-06` | Frontmatter YAML | Direta | `MD`, `FIXTURE`, `MATRIX-FE`, `APP`: validacao e preservacao literal | Sem lacuna critica conhecida na camada atual. |
| `QA-B7-07` | Atalhos de edicao | Direta | `CM`: Markdown e operacoes nativas | Nem toda combinacao e exercitada em Windows real. |
| `QA-B7-08` | Autocomplete contextual | Direta | `CM`: notas, tags, anexos e comandos | Falta interacao visual completa pelo teclado. |
| `QA-B7-09` | Busca e substituicao na nota | Direta | `CM`: abertura do painel nativo | Substituicao e modo Misto merecem cenarios adicionais. |
| `QA-B7-10` | Operacoes de linhas e blocos | Direta | `CM`: duplicacao e exclusao de linhas | Movimento e selecao de linha nao possuem a mesma profundidade. |
| `QA-B7-11` | Drag and drop no editor | Lacuna | Nao foi encontrada regressao que dispare o evento e valide importacao/insercao | Listeners sao mockados, mas a jornada nao e executada. |
| `QA-B7-12` | Integridade de links | Direta | `VAULT`, `RUST` e `E2E-WIN`: resolucao, links quebrados, rename/move, rollback e reabertura real | Coberto no Windows; falta ampliar a matriz desktop. |
| `QA-B7-13` | Preview de links internos | Lacuna | `APP` cobre clique/navegacao, nao o hover com tooltip | Falta carregar titulo/resumo e fechar o preview. |
| `QA-B7-14` | Atualizacao externa de arquivos | Indireta | `RUST`: watcher; `APP`: remocoes e recuperacao de rascunho | Falta conflito de edicao externa com as duas escolhas do usuario. |
| `QA-B7-15` | Preferencias de leitura | Indireta | `CM`: corretor ortografico | Falta fonte, largura, quebra de linha, persistencia e recarga. |
| `QA-B7-16` | Acessibilidade do editor | Indireta | `APP`, `CM`, `PDF`: roles, labels e estados acessiveis usados nas assercoes | Falta auditoria automatizada, teclado completo e contraste no browser real. |
| `QA-B7-17` | Testes de regressao do editor | Direta | `APP` e `CM`: suites explicitamente dedicadas | Ainda nao sao E2E desktop. |
| `QA-B7-18` | Notas diarias | Direta | `APP` e `VAULT`: criacao pela palette e caminho pela data local | Falta timezone/reinicio no desktop real. |

## Bloco 8: Compatibilidade com Vaults Obsidian

| ID | Feature | Cobertura | Evidencia atual | Limite conhecido |
| --- | --- | --- | --- | --- |
| `QA-B8-01` | Contrato de compatibilidade V1 | Direta | `FIXTURE`, `MATRIX-FE`, `RUST`: clausulas centrais executadas | O texto do contrato nao e validado automaticamente contra todos os testes. |
| `QA-B8-02` | Suite de Vaults de compatibilidade | Direta | `FIXTURE`, `MATRIX-FE`, `RUST`: estudos e projetos | Matriz de sistemas operacionais ainda ausente. |
| `QA-B8-03` | Preservacao sem perdas do frontmatter | Direta | `MD`, `MATRIX-FE`, `APP`: comentarios, ordem, anchors e CRLF | Falta E2E desktop. |
| `QA-B8-04` | Preservacao de Markdown nao suportado | Direta | `MD`, `FIXTURE`, `MATRIX-FE`: equivalencia e sanitizacao | Falta E2E desktop. |
| `QA-B8-05` | Wikilinks completos | Direta | `VAULT`, `APP`, `RUST`: caminhos, aliases, fragments e duplicatas | Matriz multiplataforma ainda ausente. |
| `QA-B8-06` | Embeds e transclusoes | Direta | `EMBED`, `PDF`, `VAULT`, `APP`, `RUST` | PDF.js e IPC sao mockados no frontend. |
| `QA-B8-07` | Tags compativeis | Direta | `VAULT`, `RUST`: corpo, YAML, Unicode e limites | Falta E2E do filtro completo. |
| `QA-B8-08` | Anexos compativeis | Direta | `VAULT`, `RUST`: quatro destinos, seguranca e concorrencia | Falta jornada desktop e filesystems multiplataforma. |
| `QA-B8-09` | Arquivos e configuracoes `.obsidian/` | Direta | `VAULT`, `RUST`: whitelist, limites, symlink e bytes preservados | Falta contrato IPC ponta a ponta. |
| `QA-B8-10` | Plugins e arquivos especiais | Direta | `VAULT`, `APP`, `RUST`: inventario read-only e limite | Falta E2E desktop. |
| `QA-B8-11` | Deteccao de mudancas externas | Direta | `RUST` e `APP`: watcher, rename, remocao e reconciliacao | Conflito de modificacao continua parcial. |
| `QA-B8-12` | Renomeacao compativel | Direta | `RUST` + `E2E-WIN`: semantica transacional e jornada real com links/abas/reabertura | macOS ainda nao integra a matriz E2E. |
| `QA-B8-13` | Matriz de regressao Obsidian | Direta | `MATRIX-FE` e `RUST`: round-trip e preservacao de arvore | Falta executar a matriz em Windows e macOS. |

## Bloco 6: Configuracoes

| ID | Feature | Cobertura | Evidencia atual | Limite conhecido |
| --- | --- | --- | --- | --- |
| `QA-B6-01` | Auto Save | Direta | `APP`: debounce e chamada de persistencia | Falta recarregar a preferencia no desktop real. |
| `QA-B6-02` | Atalhos | Indireta | `VAULT` e `CM`: matching e execucao | Falta alterar, persistir e recarregar configuracao. |
| `QA-B6-03` | Preferencia de reabrir ultimo vault | Indireta | `VAULT` e `RUST`: schema e default | Falta configurar ambos os modos e reiniciar o app. |

## Classificacao por criticidade

### Politica

| Nivel | Definicao | Gate minimo |
| --- | --- | --- |
| **Critica** | Uma regressao pode perder/corromper dados, sobrescrever arquivos, impedir abertura/salvamento, escapar do Vault ou quebrar uma garantia de seguranca/preservacao. | Duas camadas independentes; quando envolve filesystem, ao menos uma deve usar arquivos reais. Windows torna-se gate obrigatorio nas tasks multiplataforma. |
| **Alta** | Jornada central de uso, edicao ou navegacao cuja falha degrada seriamente o produto sem risco direto de dano irreversivel. | Cobertura direta mais smoke/E2E planejado para a jornada principal. |
| **Padrao** | Recurso auxiliar, read-only, visual ou de conveniencia com impacto isolado. | Teste direto ou indireto proporcional ao risco. |

Camadas independentes significam fronteiras diferentes, por exemplo componente e workspace, frontend e backend Rust, ou backend e E2E desktop. Dois casos no mesmo helper nao contam como duas camadas. `Atende` abaixo descreve apenas a diversidade atual; matriz de sistemas operacionais e E2E continuam sendo gates adicionais do roadmap.

### Features criticas

| ID | Risco protegido | Camadas atuais | Gate de duas camadas |
| --- | --- | --- | --- |
| `QA-B1-01` | Vault existente nao abre ou e inspecionado incorretamente | `RUST` | **Pendente**: falta workspace/E2E de abertura real. |
| `QA-B1-02` | Criacao fora do destino, estrutura incompleta ou Vault inutilizavel | `RUST` + `E2E-WIN` | **Atende**. |
| `QA-B1-03` | Vault Obsidian e alterado ou indexado incorretamente | `FIXTURE`/`MATRIX-FE` + `RUST` | **Atende**. |
| `QA-B1-06` | Pasta criada fora do Vault ou em caminho inseguro | `RUST` | **Pendente**: falta workspace/E2E. |
| `QA-B1-07` | Renomeacao perde item, aba ou referencias | `RUST` + `E2E-WIN` | **Atende**. |
| `QA-B1-08` | Movimento sobrescreve, perde item ou escapa do Vault | `RUST` + `E2E-WIN` | **Atende**. |
| `QA-B1-09` | Exclusao/restauracao perde ou sobrescreve dados | `RUST` | **Pendente**: falta jornada visual independente. |
| `QA-B2-01` | Criacao sobrescreve nota ou nao persiste | `APP` + `RUST` | **Atende**. |
| `QA-B2-02` | Edicao corrompe Markdown ou perde conteudo | `CM`/`APP` + `FIXTURE`/`MATRIX-FE` | **Atende**. |
| `QA-B2-03` | Salvamento falha ou grava conteudo incorreto | `APP` + `RUST`/fixtures | **Atende**. |
| `QA-B2-04` | Autosave perde alteracoes silenciosamente | `APP` + `E2E-WIN` | **Atende**. |
| `QA-B2-06` | Troca de aba perde rascunho nao salvo | `CM` + `APP` | **Atende**. |
| `QA-B2-09` | Anexo sobrescreve, escapa do Vault ou vai ao destino errado | `VAULT`/`PDF` + `RUST` | **Atende**. |
| `QA-B4-02` | Undo/redo nao recupera estado ou reaplica operacao errada | `CM` + `RUST` | **Atende**. |
| `QA-B4-03` | Historico persistente perde ou corrompe operacoes | `RUST` | **Pendente**: falta reinicio em segunda camada. |
| `QA-B7-01` | Editor central perde documento, cursor ou estado | `CM` + `APP` | **Atende**. |
| `QA-B7-02` | Historico por nota mistura ou perde edicoes | `CM` | **Pendente**: falta workspace/E2E dedicado. |
| `QA-B7-03` | Debounce ignora edicao concorrente ou nao salva | `APP` + `E2E-WIN` | **Atende**. |
| `QA-B7-06` | Edicao de frontmatter remove ou reserializa dados | `MD`/`MATRIX-FE` + `APP` | **Atende**. |
| `QA-B7-11` | Drag and drop escreve fora do Vault ou insere link incorreto | Nenhuma regressao direta | **Pendente**: faltam as duas camadas. |
| `QA-B7-12` | Rename/move quebra links ou aplica transacao parcial | `VAULT`/`APP` + `RUST` | **Atende**. |
| `QA-B7-14` | Mudanca externa sobrescreve rascunho ou deixa estado inconsistente | `APP` + `RUST` | **Atende**, com cenarios de conflito ainda incompletos. |
| `QA-B8-01` | Implementacao viola o contrato de preservacao V1 | `FIXTURE`/`MATRIX-FE` + `RUST` | **Atende**. |
| `QA-B8-03` | Frontmatter Obsidian sofre perda silenciosa | `MD`/`MATRIX-FE` + `RUST` | **Atende**. |
| `QA-B8-04` | Sintaxe desconhecida e removida/reformatada | `MD`/`FIXTURE` + `RUST` | **Atende**. |
| `QA-B8-06` | Embed le caminho indevido, trava ou altera fonte | `EMBED`/`PDF` + `RUST` | **Atende**. |
| `QA-B8-08` | Anexo Obsidian escapa, sobrescreve ou viola configuracao | `VAULT` + `RUST` | **Atende**. |
| `QA-B8-09` | `.obsidian` e exposto, alterado ou usado para escape | `VAULT` + `RUST` | **Atende**. |
| `QA-B8-10` | Arquivo de plugin/especial e editado ou exposto | `APP`/`VAULT` + `RUST` | **Atende**. |
| `QA-B8-11` | Evento externo perde mudanca ou sobrescreve estado local | `APP` + `RUST` | **Atende**. |
| `QA-B8-12` | Renomeacao compativel aplica alteracao parcial ou perde links | `RUST` + `E2E-WIN` | **Atende**. |
| `QA-B6-01` | Configuracao de autosave causa perda silenciosa | `APP` | **Pendente**: falta persistencia/reinicio em segunda camada. |

**Resultado do gate critico atual:** 25 atendem duas camadas independentes; 7 estao pendentes. `Atende` nao elimina a necessidade da matriz Windows/macOS nem da ampliacao do E2E desktop.

### Features de criticidade alta

| ID | Feature | Motivo |
| --- | --- | --- |
| `QA-B1-04` | Reabrir ultimo vault | Afeta entrada no workspace e previsibilidade do startup. |
| `QA-B1-05` | Navegacao por pastas | Jornada central para localizar conteudo. |
| `QA-B2-05` | Abas de notas | Organiza o trabalho corrente e estados abertos. |
| `QA-B2-08` | Toolbar de formatacao | Modifica conteudo por interacao direta. |
| `QA-B2-10` | Links internos e backlinks | Navegacao central e integridade percebida do conhecimento. |
| `QA-B2-11` | Tags | Organizacao e recuperacao central de notas. |
| `QA-B3-01` | Busca rapida de notas | Principal atalho de navegacao. |
| `QA-B3-02` | Filtro por nome de nota | Localizacao cotidiana de conteudo. |
| `QA-B3-03` | Busca por conteudo | Recuperacao de informacao no Vault. |
| `QA-B3-04` | Busca por tags | Navegacao estrutural por taxonomia. |
| `QA-B4-01` | Atalhos configuraveis | Afeta comandos globais e fluxo de produtividade. |
| `QA-B4-05` | Command palette | Porta de entrada para comandos importantes. |
| `QA-B4-06` | Templates de nota | Determina conteudo inicial criado pelo usuario. |
| `QA-B7-04` | Live Preview por bloco | Modo central de edicao/renderizacao. |
| `QA-B7-05` | Markdown completo | Fidelidade de edicao e leitura. |
| `QA-B7-07` | Atalhos de edicao | Modifica conteudo e estrutura rapidamente. |
| `QA-B7-08` | Autocomplete contextual | Insere referencias, tags, anexos e comandos. |
| `QA-B7-09` | Busca e substituicao na nota | Pode modificar varias ocorrencias no documento. |
| `QA-B7-10` | Operacoes de linhas e blocos | Modifica trechos inteiros do documento. |
| `QA-B7-16` | Acessibilidade do editor | Determina se jornadas centrais sao utilizaveis por teclado/tecnologia assistiva. |
| `QA-B7-17` | Testes de regressao do editor | Gate transversal do editor. |
| `QA-B7-18` | Notas diarias | Cria e abre arquivos por uma jornada automatizada. |
| `QA-B8-02` | Suite de Vaults de compatibilidade | Protecao transversal das fixtures suportadas. |
| `QA-B8-05` | Wikilinks completos | Resolucao e navegacao compativeis com Obsidian. |
| `QA-B8-07` | Tags compativeis | Indexacao coerente entre corpo, YAML e filtros. |
| `QA-B8-13` | Matriz de regressao Obsidian | Gate transversal de preservacao e round-trip. |
| `QA-B6-03` | Preferencia de reabrir ultimo vault | Controla comportamento do startup. |

### Features de criticidade padrao

| ID | Feature | Motivo |
| --- | --- | --- |
| `QA-B2-07` | Preview renderizado de Markdown | Leitura read-only; falha visual nao altera a fonte. |
| `QA-B3-05` | Favoritos e notas fixadas | Conveniencia de organizacao sem mutacao das notas. |
| `QA-B4-04` | Builder Mode | Rotulos visuais auxiliares. |
| `QA-B7-13` | Preview de links internos | Tooltip read-only; navegacao por clique e requisito separado. |
| `QA-B7-15` | Preferencias de leitura | Apresentacao e corretor, sem alterar o Markdown salvo. |
| `QA-B6-02` | Atalhos | Preferencia de interacao; execucao dos comandos e coberta por requisitos proprios. |

### Resumo de criticidade

| Nivel | Features | Percentual do catalogo |
| --- | ---: | ---: |
| Critica | 32 | 49,2% |
| Alta | 27 | 41,5% |
| Padrao | 6 | 9,2% |
| **Total** | **65** | **100%** |

## Resumo de cobertura

| Classificacao | Features | Percentual do catalogo |
| --- | ---: | ---: |
| Direta | 44 | 67,7% |
| Indireta | 15 | 23,1% |
| Lacuna | 6 | 9,2% |
| **Total** | **65** | **100%** |

As seis lacunas explicitas sao busca rapida, favoritos/notas fixadas, Builder Mode, templates, drag and drop e preview de links por hover. Cobertura direta nao significa cobertura E2E: as limitacoes por camada, criticidade e plataforma permanecem registradas e orientam as proximas tasks do roadmap de qualidade.
