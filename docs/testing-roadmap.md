# Roadmap de Qualidade e Testes

**Status:** Em execucao — base implementada; backlog Windows em ordem otimizada

**Prioridade de plataformas:** Windows > macOS > Ubuntu

## Objetivo

Dar alta confianca de que as funcionalidades marcadas como implementadas funcionam no aplicativo desktop distribuido, com Windows como plataforma primaria e gate obrigatorio de release. Nenhuma suite garante ausencia absoluta de defeitos; a garantia pratica vem de camadas independentes que validam logica, contratos, filesystem, interface, binario instalado e plataformas suportadas.

## Baseline atual

- 110 testes frontend em Vitest/JSDOM.
- 73 testes Rust no Windows e 59 no Ubuntu/macOS, com forte cobertura de filesystem, contratos IPC e compatibilidade Obsidian.
- CI em Ubuntu preserva o feedback rapido; o job `Windows required` executa lint, typecheck, testes frontend/Rust, a jornada E2E critica e build do executavel Tauri em `windows-latest`.
- Fixtures reais de Vaults Obsidian e comparacoes byte a byte.
- Cobertura instrumentada publica diagnosticos no log e artefatos LCOV/JSON summary da CI. A fotografia inicial, ambiente pinado, escopo e reproducao local estao em [testing-coverage.md](testing-coverage.md).
- A suite E2E do binario Tauri usa WebdriverIO com driver embedded no Windows e ja cobre criacao, autosave e reabertura em nova sessao. A CI cobre Windows e Ubuntu; macOS e a matriz E2E multiplataforma permanecem planejados para a V2.

## Modelo de garantia

| Camada | Responsabilidade | Frequencia alvo |
| --- | --- | --- |
| Unitarios e componentes | Logica Markdown, CodeMirror, schemas, componentes e regras puras | Todo PR |
| Integracao Rust/filesystem | Arquivos reais, concorrencia, watchers, links, rollback e confinamento | Todo PR nas plataformas obrigatorias |
| Contratos IPC | Payload produzido pelo Rust e aceito pelo frontend sem drift | Todo PR |
| E2E desktop | React, WebView, IPC Tauri, Rust e filesystem funcionando juntos | Windows em todo PR; demais conforme matriz |
| Aceitacao de release | Instalador e jornadas criticas em maquina real | Toda release candidata |

## Historico implementado

As entregas abaixo permanecem registradas como base obrigatoria. A reorganizacao do backlog nao altera seu estado nem seus criterios de conclusao.

### Marco 0: Rastreabilidade e baseline

**Objetivo:** saber quais requisitos estao protegidos e impedir que uma feature seja considerada concluida apenas porque existe algum teste relacionado.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Catalogo de requisitos testaveis | Implementado | A matriz em [testing-traceability.md](testing-traceability.md) atribui 65 IDs estaveis e aponta cobertura direta, indireta ou lacuna, com evidencia e limite conhecido por feature. |
| Classificacao por criticidade | Implementado | A [matriz de rastreabilidade](testing-traceability.md#classificacao-por-criticidade) classifica as 65 features: 32 criticas, 27 altas e 6 padrao. Das criticas, 25 ja possuem duas camadas independentes e 7 orientam as proximas lacunas prioritarias. |
| Cobertura instrumentada | Implementado | [testing-coverage.md](testing-coverage.md) documenta versoes pinadas, comandos, escopo e fotografia inicial. Frontend gera JSON summary e LCOV com linhas/branches V8; Rust estavel mede linhas/regioes/funcoes e exporta LCOV. A CI valida os tres relatorios, preserva artefatos parciais por 14 dias e nao aplica percentual minimo antes de limites por modulo critico. Branch coverage Rust permanece fora do gate porque exige nightly e ainda e instavel. |
| Politica de flakiness | Implementado | [testing-flakiness.md](testing-flakiness.md) torna a primeira falha bloqueante, mantem retries em zero, preserva logs/JUnit na CI e exige issue com responsavel, prazo e evidencias. Skip, assercao enfraquecida e quarentena silenciosa nao liberam o gate. |

### Marco 1: Windows como gate principal

**Objetivo:** nenhum PR pode ser integrado se quebrar compilacao, testes ou comportamentos criticos no Windows.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Job Windows obrigatorio | Implementado no workflow | O job de nome unico `Windows required` usa `windows-latest`, versoes pinadas de Node/Rust, `npm ci`, lint, typecheck, testes frontend, `cargo check`, testes Rust e bundle Tauri release. Produz NSIS x64, instala-o silenciosamente em diretorio temporario isolado, executa smoke da janela principal a partir da instalacao, executa o desinstalador e confirma a remocao dos arquivos no diretorio isolado, publica instalador e manifesto SHA-256 e preserva diagnosticos por 14 dias. Depois do primeiro run no GitHub, `CI / Windows required` deve ser selecionado como status check obrigatorio na regra da branch principal. |
| Suite de caminhos Windows | Implementado | Cinco testes cobrem separadores nativos, rejeicao de caminhos com unidade, raiz, UNC e namespace de dispositivo, nomes reservados inclusive com extensao, Unicode e case-insensitivity do NTFS e leitura/escrita acima de 260 caracteres. Os cenarios dependentes do Windows usam cfg(windows); a validacao portavel de nomes reservados roda em todas as plataformas. |
| Suite NTFS de seguranca | Implementado | Cinco testes exclusivos do Windows exercitam junction real escapando do Vault, handle sem compartilhamento de escrita/exclusao, troca concorrente por junction com rollback, troca de ancestral entre check e replace e substituicao atomica observada durante 128 versoes sem janela de caminho ausente. O commit usa MoveFileExW com replace e backup hard-link, retries limitados para sharing violations e temporarios ancorados na raiz. Testes portaveis existentes cobrem nao sobrescrita e rollback multiplo. Os cenarios de symlink registram NTFS_CAPABILITY_UNAVAILABLE somente para o erro 1314, sem retorno silencioso. |
| Watcher no Windows | Implementado | Cinco testes exclusivos do Windows usam Vaults NTFS temporarios e operacoes externas reais. A jornada cobre criacao, duas edicoes rapidas, renomeacao, movimentacao entre pastas e exclusao, valida globalmente as contagens inclusive de modificacoes e reconstrui o estado final a partir dos eventos. Fragmentos `From`/`To` sem identidade confiavel permanecem como `remove`/`create`; modificacoes repetidas usam debounce trailing-edge de 250 ms. O canal e o acumulador Rust sao limitados a 1024; overflow emite `rescan` imediato, periodico durante tempestade continua e final apos quietude. A fila frontend e limitada a 128, colapsa para `rescan` sem renovar o debounce e coordena scans IPC em single-flight. Cada payload carrega o `requestId` da ativacao para que eventos atrasados de outro Vault sejam descartados. Testes adicionais comprovam saturacao continua, limite do acumulador, ativacao ordenada, escopo serializado, substituicao/fechamento do worker e cinco contratos da fila/coordenador da interface. |

## Backlog Windows em ordem otimizada

A ordem abaixo fecha primeiro os contratos entre camadas, depois valida o artefato distribuivel, instala a infraestrutura E2E uma unica vez e somente entao amplia as jornadas. Cada marco depende do anterior e deve manter verdes os marcos implementados.

### Marco 2: Contrato IPC executavel

**Objetivo:** impedir drift silencioso entre os payloads serializados pelo Rust e os dados aceitos pelo frontend.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Contrato IPC executavel | Implementado | O fixture versionado `ipc-contract-v1.json` e reconstruido a partir dos tipos, enums e constantes reais do Rust e comparado estruturalmente em teste. A mesma evidencia e consumida pelos schemas Zod da interface para abertura de Vault, documento e lista de notas, preferencias recentes, inventario especial, status de historico e watcher. Quatro testes frontend cobrem payload atual, versao do contrato, compatibilidade legada sem `obsidianPreferences`, objeto e campos internos nullable, limites compartilhados e rejeicao de eventos watcher malformados. O watcher usa enum Rust fechado para os cinco tipos e schema discriminado com cardinalidade, inteiro seguro, caminhos relativos e orcamento por evento. A ampliacao aos comandos de menor risco permanece incremental. |

### Marco 3: Artefato Windows distribuivel

**Objetivo:** testar o mesmo tipo de artefato que sera entregue ao usuario, nao apenas o frontend ou um executavel de desenvolvimento.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Build do artefato Windows | Implementado | O job `Windows required` gera um bundle release NSIS x64, exige exatamente um instalador nao vazio e valida produto, versao e arquitetura pelo nome. O instalador e executado silenciosamente em diretorio temporario unico; o gate calcula SHA-256 do instalador e do executavel instalado, inicia essa copia, confirma a janela principal `MirrorMind`, encerra o app, executa o desinstalador e exige que o diretorio isolado fique sem residuos. Somente depois do smoke o NSIS e o manifesto versionado com commit de origem sao publicados por 14 dias; logs de build e instalacao permanecem nos diagnosticos mesmo em falha. Assinatura e instalacao limpa em maquina separada continuam no gate de release real. |

### Marco 4: Infraestrutura E2E e primeira jornada

**Objetivo:** testar o aplicativo Tauri real da interface ate os bytes gravados no disco e estabelecer uma base reutilizavel para as jornadas seguintes.

Usar WebdriverIO com o servico oficial para Tauri e driver embedded. Cada teste cria um Vault temporario isolado, controla dados e tempo quando necessario, fecha o aplicativo e remove seus artefatos. Falhas devem anexar screenshot, logs frontend/backend e arvore final do Vault sem expor conteudo sensivel.

| Task/Jornada | Estado | Criterio de conclusao |
| --- | --- | --- |
| Infraestrutura E2E Tauri no Windows | Implementado | WebdriverIO usa os plugins Tauri e driver embedded em build debug dedicado com feature Cargo `e2e`, identificador e permissoes exclusivos. O runner executa jornadas isoladas, cada uma em processos separados que compartilham apenas seu Vault/AppData; a raiz temporaria usa token de propriedade e rejeita reparse points antes da remocao. Em falha, preserva screenshot de dados sinteticos, logs frontend/backend, JUnit, stack e inventario limitado do Vault sem copiar conteudo. O smoke roda no `Windows required`. |
| Criar, salvar e reabrir | Implementado | A primeira execucao cria Vault e nota pela interface, habilita autosave e confirma os bytes Markdown no NTFS. Depois que esse processo encerra, uma segunda execucao confirma o modal padrao do Vault recente, reabre o Vault pela interface e valida o conteudo no editor e no arquivo. |

### Marco 5: Integridade de dados no E2E

**Objetivo:** proteger primeiro as jornadas cuja regressao pode perder, sobrescrever ou deixar dados e links inconsistentes.

| Jornada | Estado | Criterio de conclusao |
| --- | --- | --- |
| Renomear e mover com links | Em validacao | A implementacao usa uma raiz isolada para renomear e mover nota/pasta pela interface, validar wikilinks, caminhos, bytes no NTFS e salvar pelas abas remapeadas; um segundo processo reabre somente os caminhos finais. O Gate 2 da versao reforcada aguarda nova execucao E2E por limite temporario da plataforma. |
| Lixeira e restauracao | Planejado | Exclui, restaura e confirma que nenhum item existente foi sobrescrito. |
| Mudanca externa e conflito | Planejado | Modifica/remove arquivo fora do app e valida reconciliacao, preservacao do rascunho e escolha do usuario. |

### Marco 6: Promessas centrais do produto

**Objetivo:** completar a cobertura ponta a ponta da compatibilidade Obsidian, falha segura, anexos e preferencias persistentes.

| Jornada | Estado | Criterio de conclusao |
| --- | --- | --- |
| Abrir Vault Obsidian | Planejado | Abre fixture real, navega e edita nota suportada sem alterar `.obsidian` ou arquivos desconhecidos. |
| Falha segura | Planejado | Simula arquivo bloqueado ou alteracao concorrente e confirma mensagem clara, ausencia de perda e rollback. |
| Anexo completo | Planejado | Importa arquivo, insere embed, renderiza e confirma destino conforme `attachmentFolderPath`. |
| Configuracoes persistentes | Planejado | Altera autosave, atalhos e reabertura; reinicia e confirma as preferencias. |

### Marco 7: Gate de release em Windows real

**Objetivo:** validar o artefato que sera usado fora da maquina virtual da CI.

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Matriz Windows suportada | Planejado | Versao minima do Windows e arquiteturas suportadas sao decididas e documentadas. Windows 11 x64 e o alvo primario provisorio ate essa decisao. |
| Instalacao limpa | Planejado | Instalador assinado e instalado em maquina limpa; abertura, fechamento, reinstalacao e desinstalacao nao perdem Vaults do usuario. |
| Vault NTFS local | Planejado | Jornadas criticas passam em disco local com caminhos curtos/longos, Unicode e arquivos abertos por outros processos. |
| Vault sincronizado pelo OneDrive | Planejado | Abertura, autosave, conflito, renomeacao e restauracao sao validados em pasta realmente sincronizada, incluindo concorrencia com o cliente OneDrive e arquivos ainda nao materializados quando aplicavel. |
| Checklist de release | Planejado | Cada release candidata registra SO, arquitetura, artefato, jornadas executadas, resultados e riscos aceitos. |

## Gates Windows propostos

| Evento | Windows |
| --- | --- |
| Pull request | Testes completos, build desktop e E2E critico obrigatorios. |
| Nightly | E2E completo e casos caros de filesystem. |
| Release candidata | CI verde mais aceitacao em maquina real e OneDrive. |

## Ordem recomendada de execucao

1. Implementar o contrato IPC executavel, comecando pelos payloads mais criticos.
2. Produzir o artefato Windows distribuivel e adicionar smoke de inicializacao.
3. Instalar a infraestrutura E2E Tauri e entregar `Criar, salvar e reabrir`.
4. Cobrir renomeacao/movimentacao com links.
5. Cobrir lixeira e restauracao sem sobrescrita.
6. Cobrir mudanca externa e conflito de rascunho.
7. Cobrir abertura e edicao segura de Vault Obsidian.
8. Cobrir falha segura e rollback.
9. Cobrir anexos e configuracoes persistentes.
10. Formalizar o gate de release em Windows real, instalacao limpa, NTFS e OneDrive.

## Qualidade posterior ao gate Windows

Os jobs, filesystems, E2E e arquiteturas de macOS e Ubuntu foram movidos para [v2-features-roadmap.md](v2-features-roadmap.md#bloco-v22-qualidade-e-testes-multiplataforma). Essa transferencia preserva o planejamento, mas evita que o suporte secundario concorra com o fechamento da confiabilidade no Windows.

## Riscos nao bloqueantes para tratar posteriormente

| Risco | Direcao futura |
| --- | --- |
| Actions da CI usam tags moveis (`@v4`, `@v2` e `@stable`) | Fixar cada action por SHA completo e configurar atualizacoes automatizadas. |
| Branch coverage Rust exige nightly e permanece instavel | Reavaliar quando a instrumentacao estiver estavel sem comprometer o toolchain de release. |
| Cobertura ainda nao possui limites por modulo critico | Estabilizar os baselines multiplataforma e definir limites incrementais por risco. |
| Bundle principal permanece acima de 500 kB | Planejar code splitting sem misturar otimizacao de bundle com o roadmap de testes. |
| Cobertura Rust pode iniciar depois de falha de setup ou durante cancelamento | Refinar as condicoes do job sem perder a preservacao de relatorios parciais. |
| Versao Rust esta duplicada no workflow e em `rust-toolchain.toml` | Adotar uma unica fonte de verdade que continue aceita pelas actions. |
| Push e pull request da mesma branch podem duplicar execucoes | Unificar a chave de concorrencia ou restringir os triggers quando a politica de branches estiver definida. |
| A fotografia local de cobertura referencia um working tree e comandos PowerShell | Registrar o commit final e adicionar exemplos equivalentes para macOS/Linux. |
| Abertura, atribuicao e prazo de issues de flakiness dependem de disciplina manual | Automatizar validacoes quando houver volume que justifique um bot ou workflow dedicado. |
| Diagnosticos sem limite proprio podem crescer ou conter dados inseridos manualmente | Definir timeout/tamanho e manter redacao obrigatoria antes de anexar evidencias locais. |
| Reruns verdes e introducao de testes ignorados ainda dependem de revisao humana | Criar deteccao com allowlist e uma regra de merge que preserve a falha original. |
| Rust preserva log textual, mas ainda nao produz JUnit | Adotar reporter estruturado quando a matriz multiplataforma justificar a dependencia adicional. |
| Payloads de notas e listas ainda nao possuem orcamentos globais compartilhados | Definir limites e comportamento de truncamento a partir de requisitos para Vaults grandes antes de transformar essa protecao em contrato Rust/Zod. |
| A obrigatoriedade do check `CI / Windows required` depende da regra remota da branch | Ativar o status check nas configuracoes do GitHub depois que o workflow executar pela primeira vez. |
| `windows-latest` e uma imagem movel em VM hospedada | Fixar a imagem Windows quando a versao minima suportada for decidida e manter o gate em maquina real para releases. |
| O primeiro build Tauri sem cache Cargo pode se aproximar do timeout de 45 minutos | Observar os primeiros runs e adicionar cache com chave do lockfile se a duracao justificar. |
| Variantes drive-relative e namespaces UNC/device ainda nao possuem casos explicitos | Adicionar C:escape, UNC com barras normais, UNC estendido, volume GUID e GLOBALROOT sem relaxar a rejeicao atual por Prefix/Root. |
| Caminho acima de 260 caracteres e exercitado pelo resolvedor e pelo filesystem, nao pelo fluxo completo de persistencia | Cobrir salvar, reabrir e operacoes atomicas no contrato IPC e na futura suite E2E desktop. |
| Unicode e case-insensitivity compartilham um unico teste em NTFS padrao | Separar diagnosticos e documentar ou testar volumes Windows com case-sensitivity habilitada, incluindo NFC/NFD, emoji e RTL. |
| Mensagens da validacao de segmentos ainda mencionam vault | Generalizar as mensagens quando o tratamento de erros de caminhos for revisado. |
| Cobertura especifica de symlink depende de Developer Mode ou SeCreateSymbolicLinkPrivilege | Manter o diagnostico NTFS_CAPABILITY_UNAVAILABLE na CI e executar o gate de release Windows em uma maquina com a capacidade habilitada; junctions continuam cobrindo reparse points sem privilegio. |
| Pares `From`/`To` do backend Windows nao carregam tracker/cookie | Manter a representacao conservadora `remove`/`create` ate que o `notify` ou a API nativa exponha identidade confiavel; aceitar que renomes externos nao preservem remapeamento de estado na interface nesse intervalo. |
| Paths NTFS nao representaveis em UTF-8 usam conversao lossy nos eventos | Tratar nomes com conversao ambigua como `rescan` ou evoluir o contrato IPC para representacao lossless. |
| Encerramento do watcher ainda ocorre enquanto o mutex do estado global esta adquirido | Mover o drop/join para fora da secao critica quando o lifecycle do estado Tauri for refatorado. |
| O override de `@wdio/native-utils` corrige uma incompatibilidade entre os pacotes Tauri 1.2.0 e deve ser removido quando o upstream alinhar a dependencia | Acompanhar releases de `@wdio/tauri-service` e retirar o override depois de um build/E2E verde sem ele. |
| O bundle release ainda nao possui um gate negativo que prove a ausencia das capabilities WDIO | Inspecionar o artefato normal ou adicionar teste de capability antes de distribuir builds fora da configuracao E2E dedicada. |
| O WebDriver embedded usa porta loopback previsivel e sem autenticacao durante o teste | Manter o binario E2E efemero e nao distribuivel; migrar para porta livre aleatoria quando o provider suportar discovery confiavel. |
| Falhas anteriores ao `afterTest` preservam logs, mas nao screenshot, stack e inventario | Adicionar diagnosticos de startup no runner se os primeiros runs da CI mostrarem falhas de inicializacao dificeis de reproduzir. |

## Referencias oficiais

- [Testes WebDriver no Tauri](https://v2.tauri.app/develop/tests/webdriver/)
- [CI para testes WebDriver no Tauri](https://v2.tauri.app/develop/tests/webdriver/ci/)
- [Runners hospedados do GitHub Actions](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)
