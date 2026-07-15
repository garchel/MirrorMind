# Roadmap de Qualidade e Testes

**Status:** Planejamento

**Prioridade de plataformas:** Windows > macOS > Ubuntu

## Objetivo

Dar alta confianca de que as funcionalidades marcadas como implementadas funcionam no aplicativo desktop distribuido, com Windows como plataforma primaria e gate obrigatorio de release. Nenhuma suite garante ausencia absoluta de defeitos; a garantia pratica vem de camadas independentes que validam logica, contratos, filesystem, interface, binario instalado e plataformas suportadas.

## Baseline atual

- 99 testes frontend em Vitest/JSDOM.
- 56 testes Rust, com forte cobertura de filesystem e compatibilidade Obsidian.
- CI em Ubuntu executando lint, typecheck, testes, build frontend, `cargo check` e `cargo test`.
- Fixtures reais de Vaults Obsidian e comparacoes byte a byte.
- Ainda nao existe suite E2E do binario Tauri, matriz de CI por sistema operacional ou metrica instrumentada de cobertura.

## Modelo de garantia

| Camada | Responsabilidade | Frequencia alvo |
| --- | --- | --- |
| Unitarios e componentes | Logica Markdown, CodeMirror, schemas, componentes e regras puras | Todo PR |
| Integracao Rust/filesystem | Arquivos reais, concorrencia, watchers, links, rollback e confinamento | Todo PR nas plataformas obrigatorias |
| Contratos IPC | Payload produzido pelo Rust e aceito pelo frontend sem drift | Todo PR |
| E2E desktop | React, WebView, IPC Tauri, Rust e filesystem funcionando juntos | Windows em todo PR; demais conforme matriz |
| Aceitacao de release | Instalador e jornadas criticas em maquina real | Toda release candidata |

## Marco 0: Rastreabilidade e baseline

**Objetivo:** saber quais requisitos estao protegidos e impedir que uma feature seja considerada concluida apenas porque existe algum teste relacionado.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Catalogo de requisitos testaveis | Planejado | Cada item implementado de `common-note-app-features.md` recebe um identificador estavel e aponta para testes diretos, indiretos ou para uma lacuna declarada. |
| Classificacao por criticidade | Planejado | Fluxos que podem perder dados, sobrescrever arquivos, quebrar abertura/salvamento ou escapar do Vault sao classificados como criticos e exigem pelo menos duas camadas independentes de teste. |
| Cobertura instrumentada | Planejado | Frontend e Rust publicam cobertura de linhas e branches como diagnostico. Limites iniciais sao definidos depois do baseline, com gates mais rigorosos para modulos criticos, sem perseguir percentual global artificial. |
| Politica de flakiness | Planejado | Teste instavel falha o gate, gera diagnostico e recebe responsavel; retries nao podem esconder regressao permanentemente. |

## Marco 1: Windows como gate principal

**Objetivo:** nenhum PR pode ser integrado se quebrar compilacao, testes ou comportamentos criticos no Windows.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Job Windows obrigatorio | Planejado | GitHub Actions usa `windows-latest` para instalar dependencias, executar testes frontend, `cargo check`, `cargo test` e construir o aplicativo desktop. O resultado e obrigatorio na protecao da branch. |
| Suite de caminhos Windows | Planejado | Cobre letras de unidade, separadores, caminhos UNC aceitos ou rejeitados conforme contrato, nomes reservados, caminhos longos, maiusculas/minusculas e Unicode. |
| Suite NTFS de seguranca | Planejado | Cobre junctions, symlinks quando permitidos, arquivos bloqueados, troca concorrente de caminhos, sobrescrita atomica, rollback e confinamento no Vault. Casos que exigem privilegio especial sao identificados, nao silenciosamente ignorados. |
| Watcher no Windows | Planejado | Criacao, edicao, renomeacao, movimentacao e exclusao externas geram eventos esperados sem duplicacao ou perda de estado. |
| Contrato IPC executavel | Planejado | Fixtures serializadas pelo Rust sao validadas pelos schemas Zod usados pela interface, incluindo payload legado, limites e nulabilidade. |
| Build do artefato Windows | Planejado | A CI produz pelo menos um binario/instalador Windows e executa smoke test do artefato, nao apenas do frontend. |

## Marco 2: E2E desktop no Windows

**Objetivo:** testar o aplicativo Tauri real da interface ate os bytes gravados no disco.

Usar WebdriverIO com o servico oficial para Tauri e driver embedded. Cada teste cria um Vault temporario isolado, controla dados e tempo quando necessario, fecha o aplicativo e remove seus artefatos. Falhas devem anexar screenshot, logs frontend/backend e arvore final do Vault sem expor conteudo sensivel.

### Jornadas criticas

| Jornada | Estado | Criterio de conclusao |
| --- | --- | --- |
| Criar, salvar e reabrir | Planejado | Cria Vault e nota pela interface, espera autosave, fecha, reabre e confirma conteudo no app e no arquivo. |
| Abrir Vault Obsidian | Planejado | Abre fixture real, navega e edita nota suportada sem alterar `.obsidian` ou arquivos desconhecidos. |
| Renomear e mover com links | Planejado | Renomeia/move nota e pasta pela interface, valida wikilinks, abas e filesystem depois de reabrir. |
| Lixeira e restauracao | Planejado | Exclui, restaura e confirma que nenhum item existente foi sobrescrito. |
| Anexo completo | Planejado | Importa arquivo, insere embed, renderiza e confirma destino conforme `attachmentFolderPath`. |
| Mudanca externa e conflito | Planejado | Modifica/remove arquivo fora do app e valida reconciliacao, preservacao do rascunho e escolha do usuario. |
| Configuracoes persistentes | Planejado | Altera autosave, atalhos e reabertura; reinicia e confirma as preferencias. |
| Falha segura | Planejado | Simula arquivo bloqueado ou alteracao concorrente e confirma mensagem clara, ausencia de perda e rollback. |

## Marco 3: Compatibilidade macOS

**Objetivo:** manter macOS como segunda plataforma oficialmente suportada.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Job macOS por PR | Planejado | `macos-latest` executa testes Rust, testes frontend e build desktop; falhas bloqueiam release, mesmo que a politica de branch permita execucao E2E menos frequente por custo. |
| Filesystem macOS | Planejado | Cobre Unicode NFC/NFD, comportamento case-insensitive do volume padrao, symlinks, watchers e operacoes atomicas. |
| E2E macOS | Planejado | Jornadas criticas rodam com o driver embedded em agenda noturna e em toda release candidata; um smoke menor pode rodar em PRs. |
| Arquiteturas Apple | Planejado | Apple Silicon e Intel sao construidos e validados conforme as arquiteturas declaradas como suportadas. |

## Marco 4: Compatibilidade Ubuntu

**Objetivo:** preservar Ubuntu como terceira plataforma sem reduzir a prioridade dos gates Windows.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| CI Linux enxuta | Planejado | Ubuntu continua responsavel pelo feedback rapido de lint, typecheck, Vitest e build, alem dos testes Rust. |
| Filesystem Linux | Planejado | Cobre case sensitivity, permissoes Unix, symlinks e watchers. |
| E2E Linux | Planejado | Smoke desktop roda com display virtual em agenda noturna e antes de releases multiplataforma. |

## Marco 5: Gate de release em Windows real

**Objetivo:** validar o artefato que sera usado fora da maquina virtual da CI.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Matriz Windows suportada | Planejado | Versao minima do Windows e arquiteturas suportadas sao decididas e documentadas. Windows 11 x64 e o alvo primario provisorio ate essa decisao. |
| Instalacao limpa | Planejado | Instalador assinado e instalado em maquina limpa; abertura, fechamento, reinstalacao e desinstalacao nao perdem Vaults do usuario. |
| Vault NTFS local | Planejado | Jornadas criticas passam em disco local com caminhos curtos/longos, Unicode e arquivos abertos por outros processos. |
| Vault sincronizado pelo OneDrive | Planejado | Abertura, autosave, conflito, renomeacao e restauracao sao validados em pasta realmente sincronizada, incluindo concorrencia com o cliente OneDrive e arquivos ainda nao materializados quando aplicavel. |
| Checklist de release | Planejado | Cada release candidata registra SO, arquitetura, artefato, jornadas executadas, resultados e riscos aceitos. |

## Gates propostos

| Evento | Windows | macOS | Ubuntu |
| --- | --- | --- | --- |
| Pull request | Testes completos, build desktop e E2E critico obrigatorios | Testes e build; smoke E2E quando estabilizado | Lint, typecheck, Vitest, build e Rust |
| Nightly | E2E completo e casos caros de filesystem | E2E completo | E2E completo |
| Release candidata | CI verde mais aceitacao em maquina real e OneDrive | CI verde e E2E de release | CI verde se a release oferecer Linux |

## Ordem recomendada de execucao

1. Criar rastreabilidade entre as 65 features implementadas e os testes existentes.
2. Tornar o job Windows obrigatorio e corrigir qualquer incompatibilidade revelada.
3. Completar a suite Windows de filesystem e contratos IPC.
4. Instalar a infraestrutura E2E Tauri e entregar primeiro `Criar, salvar e reabrir`.
5. Adicionar as demais jornadas criticas uma por vez, mantendo isolamento e diagnosticos.
6. Adicionar macOS e depois ampliar Ubuntu sem retirar Windows do caminho critico.
7. Formalizar o gate manual de release em Windows real e OneDrive.

## Referencias oficiais

- [Testes WebDriver no Tauri](https://v2.tauri.app/develop/tests/webdriver/)
- [CI para testes WebDriver no Tauri](https://v2.tauri.app/develop/tests/webdriver/ci/)
- [Runners hospedados do GitHub Actions](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)
