# Changelog

Todas as mudanças notáveis do MirrorMind são documentadas neste arquivo. O
formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [SemVer](https://semver.org/lang/pt-BR/). A primeira
release pública ainda não foi feita; os marcos abaixo estão em
**Não publicado**.

## [Não publicado]

### Arquitetura profunda 1, 2 e 4 (skill improve-codebase-architecture)

**Adicionado**
- `review/reviewProvider.ts`: seam única dos provedores configuráveis
  (`gemini`/`openAiCompatible`) — `set/confirmDataConsent`, `configure`,
  `remove` parametrizados por kind, comandos IPC byte-idênticos em tabelas,
  transporte injetável (Tauri/in-memory); 4 testes sem mock de `invoke`.
- `review/useReviewSessionRunner.ts`: dono do ciclo plano→prompts→trocas→
  relatório (begin/answerCurrent/finish/turnos/calibration + plano estimado);
  `setBusy`/`updateReport` expostos estreitamente aos satélites
  (síntese/reclassify); 4 testes de ciclo sem montar a página.
- `lib/markdown-autocomplete.resolveMarkdownAutocompleteData()`: derivação
  dos dados do autocomplete (alvos do rascunho + backlinks vault/grafo);
  3 testes dedicados.
- `review/useNoteReadiness.ts` + `review/NoteReadinessReport.tsx`:
  `NoteReadinessControl` (880 → 391 linhas) split em ciclo de vida
  (carregar/avaliar/inscrever/resetar/recuperar/relatorio, 3 testes sem
  montar o componente) + visão do relatório (focus-trap próprio).
- `vaultIndex.setDocuments()`: guarda conteúdos sem tocar no snapshot;
  `vaultNoteContentsRef` removido do App (duplicava o `documents` do
  module) — grafo bebe do module via `getDocuments`/`setDocuments`
  (nomes via `notes`, mesma fonte da checagem de frescor).

**Alterado**
- `ReviewAiSettings` + Context consomem o provider (9 call sites); 8
  funções granulares removidas de `ai.ts` (-46; contratos zod ficam — são a
  fronteira de confiança, parte profunda).
- `ReviewSessionPage` -100 linhas líquidas: ciclo no hook, página com
  entrada/render; mesma ordem de montagem da troca e limpeza dos campos.
- App delega o `markdownAutocompleteData` ao lib (bloco inline removido).
- Candidato 2 reenquadrado na implementação: a página não espelhava estado
  do backend (11 useStates são UI local legítima; zero `invoke` direto) —
  o sem-dono real era a orquestração do ciclo de vida.

### Índice do vault com locality (lib/vaultIndex)

**Adicionado**
- Module `lib/vaultIndex.createVaultIndex()`: dono único do snapshot de
  wikilinks + cache de conteúdos (rebuild/clear/removePaths/remapPaths/
  applyEdit/entryTargets/updateDocumentContent/backlinks/targets). Puro,
  sem IPC/React — o App informa *o que mudou*, o module garante *o que
  invalida*; 7 testes mutação->query.
- `entryTargets()` (visão sem filtro, a mesma de `entries.get().targets`)
  preserva a sincronização das indexadoras no save; `targets()` filtrado
  não serviria ali.

**Alterado**
- App migrou em 3 fatias: (1) module + testes, sem uso; (2) dual-write +
  piloto `deleteVaultItem` (`affectedSources` com regra idêntica, loop
  único de sync); (3) flip de todos os leitores (build/rename/delete/
  save/background/indexadoras/toggle/autocomplete/backlinks) e remoção
  de `vaultWikilinkIndexRef` (-11 sítios manuais, mesma ordem e mensagens).
- `vaultNoteContentsRef` e o índice próprio do grafo ficam como seam
  separada (troca futura do pipeline de dados do grafo).

**Corrigido**
- Nada comportamental: regressão 63/63 sem toque + 7 testes novos; risco
  CRITICAL do `impact refreshNotes` (27 impactados) mitigado em fatias
  commitáveis e verdes sozinhas (`90aff82`, `d3f1115`).

### Extração do App.tsx: busca de notas e lixeira

**Adicionado**
- Hook `lib/useNoteSearch(vaultPath, query, enabled)`: busca debounced
  (`search_notes`, 150ms) com as mesmas regras (desabilitado/sem
  vault/vazia = `[]`; falha = `[]`); 3 testes.
- Hook `lib/useTrashItems`: itens + alvo permanente + trio
  (abrir/restaurar/excluir) com mesmos comandos, mensagens e ordem
  (alvo limpo só no sucesso); 5 testes.

**Alterado**
- App consome os dois hooks sem mudar JSX nem chamadas (nomes
  preservados); tipos `TrashItem`/`NoteSearchResult` moram nos hooks.
- `deleteTarget`/soft-delete ficam no App de propósito: tocam abas,
  rascunhos, nota ativa e índice wikilink (núcleo do editor) — extrair
  seria indireção com 10 dependências injetadas, sem ganho.

**Corrigido**
- Nada comportamental: regressão 63/63 sem toque (inclui abrir
  nota pela busca e fluxos da lixeira).

### Extração do App.tsx: todos os modais no `<Modal>` compartilhado

**Adicionado**
- Prop `builderName` no `<Modal>` (repassa `data-builder-name`; modo
  construtor identifica o modal sob o mouse).
- Ponte CSS `.modal.recent-vault-modal::backdrop` (véu + blur idênticos);
  regra `.recent-vault-backdrop` órfã removida.

**Alterado**
- 14 modais do `App.tsx` no `<Modal>` (nomes acessíveis intactos):
  arquivos especiais, viewer (erro + leitura), busca, filtro de tags,
  link, conexão do grafo, tag, pasta, renomear, mover, excluir,
  exclusão permanente e vault recente; 11 registros `useEscapeToClose`
  duplicados removidos; ganho: contenção de Tab em todos.
- Palette e dropdown de filtro rápido ficam (UX própria, sem backdrop
  modal); `SpecialFileViewer` interno inalterado.

**Corrigido**
- Conexão do grafo mantém `createPortal` + `pointerEvents: auto`: o
  drawer vaul esconde a subárvore `#root` (`aria-hidden`) e zera
  `pointer-events` do body — sem o portal o modal some da acessibilidade
  (2 regressões provaram, dump do DOM confirmou); lição registrada aqui
  para futuras migrações sobre o drawer.

### Extração do App.tsx: aparência, leitura, editor e atalhos

**Adicionado**
- Hook `lib/useAppearanceSettings`: 14 prefs (atalhos, autosave, cores de
  hover, fonte/largura de leitura, tema, fonte do editor, tamanho, limite
  de histórico, quebra de linha, spell-check, confirmação de lixeira) com
  as mesmas chaves e semântica — inclui a migração `Ctrl+Shift+M`→`Ctrl+M`
  e o padrão "ausente = ligado" do autosave; 5 testes.
- Ponte `patchShortcuts`/`resetShortcuts` (o `usePref` só aceita valor
  direto; os 6 campos de captura usavam forma funcional).

**Alterado**
- 14 estados + 14 efeitos de persistência saem do `App.tsx`; `localStorage`
  restante no App: só viewport do grafo (corretamente vault-scoped),
  `clear()` da zona de perigo e 2 comentários.
- Tipos `ReadingFont`/`ReadingWidth` moram no hook (só o App usava);
  imports órfãos removidos (`normalize*`, `DEFAULT_WORKSPACE_SHORTCUTS`).

**Corrigido**
- Nada comportamental: regressão 63/63 sem toque (inclui os testes que
  afirmam `'dark'`/`'19'`/`'250'` nas chaves legadas).

### Extração do App.tsx: grafo, prefs e modais de mudança externa

**Adicionado**
- Hook `lib/useGraphSettings`: 12 prefs numéricas do grafo 2D/3D com as
  mesmas chaves e validações (inclui arredondamento do limite); 4 testes.
- Prop `dismissable` no `<Modal>` (padrão preservado) + 3 testes.
- Ponte CSS `.modal.note-search-modal` (largura, topo 72px, backdrops por
  tema) para paridade pixel com o backdrop próprio removido.

**Alterado**
- 2 modais de mudança externa do `App.tsx` no `<Modal>` (nomes acessíveis
  intactos: E2E e regressão passam sem toque); registros `useEscapeToClose`
  duplicados removidos; ganho real: contenção de Tab.
- `reviewGapMode` e as 12 configs do grafo na camada prefs (gravação
  automática; −68 linhas no `App.tsx`, localStorage 59→34 ocorrências).

**Corrigido**
- Comentários "persistidas por vault" que nunca foram verdade (chaves do
  grafo sempre foram globais; comportamento preservado como global).
- `reviewGapMode` corrompido agora cai em `hover` em vez de vazar string
  inválida para a UI.

### Página de Metas, dark da Revisão e consolidação UI

**Adicionado**
- Página de Metas de aprendizado: metas com plano em passos, resumo geral com
  barra de progresso, notas propostas por passo, status segmentado
  (Planejado/Estudando/Concluído), exclusão em 2 cliques e modal de criação
  com IA opcional (fallback local determinístico sem provedor). Backend em
  `src-tauri/src/goals.rs` (persistência atômica em `.mirmind/goals/`).
- Metas na Command Palette (`Abrir metas`) e jornada E2E
  `goals-create-complete` (criar → concluir passo → persistência após
  reinício; fase de criação também no smoke Linux).
- Camada de preferências (`src/lib/prefs.ts`): leitura/escrita reativa com
  escopo por vault e parse seguro que nunca quebra; `useAppUpdater` migrado.
- Hook `useSettingsNav`: seções/grupos e scroll-spy das Configurações
  extraídos do `App.tsx` (−80 linhas).
- 33 tokens `--review-*`: tema escuro da Revisão com fonte única no
  `index.css` (gerador `gen-review-dark.py` aposentado e removido).

**Alterado**
- 5 diálogos migrados para o `<Modal>` compartilhado (política de revisão,
  prazo do dashboard, impacto de tag, descarte e reset de prontidão); ~90
  linhas de focus-trap/Escape manual removidas.
- Textos explicativos enxugados (~40% em 19 telas; LGPD, empty-states e
  tooltips FSRS preservados).

**Corrigido**
- Contraste WCAG AA em 6 superfícies (pastilhas da Revisão, avisos de tag,
  score inconclusivo) com tema claro pixel-idêntico.
- Acentuação pt-BR no seletor de tags de nota (mojibake `?` visível ao
  usuário).

### Auditoria UI/UX (skill ui-ux-pro-max): paleta, a11y e copy

**Adicionado**
- Escape fecha o dialog do topo em toda a aplicação: pilha global topmost
  (`src/lib/escapeStack.ts`) — 14 modais registrados; popover sobre modal
  fecha só o popover, segundo Escape fecha o modal (padrão desktop). 4 testes
  novos.
- Componentes compartilhados `PageHeader`/`PageRefreshButton` e
  `ErrorState`/`LoadingState` (substituem 3 headers e 6 blocos de erro
  duplicados nas páginas de revisão).
- Seção "Aplicativo" nas Configurações com verificação manual de atualizações
  (changelog da entrada anterior).

**Corrigido**
- Tokens `--accent-strong` e `--surface` definidos nos dois temas — eram
  usados sem definição e as páginas Painel/Relatórios herdavam fallback verde
  da paleta antiga; 20+ fallbacks desatualizados removidos dos CSS de review.
- Acentuação pt-BR consistente em ~150 strings visíveis (App, componentes,
  features, mensagem de notificação no Rust), incluindo avisos de segurança
  do `dataviewjs` e o diálogo de arquivos especiais.
- `prefers-reduced-motion` global (animações e transições de todos os shells
  respeitam a preferência; antes só 3 blocos pontuais).
- Ícones dos steppers de prioridade: 11px → 13px.

**Segurança (correções da normalização automatizada)**
- Restaurados identificadores que o script de acentuação corrompeu: tag
  `textarea` na lista de tags perigosas da sanitização, void element `area`,
  tipo `BirthState` e selector do focus-trap — auditados um a um no diff.

### Auto-updater na UI, decisão de crash reporting e Discussions

**Adicionado**
- UI completa do auto-updater (`src/lib/updater.ts`,
  `src/lib/useAppUpdater.ts`, `src/components/UpdateBanner.tsx`):
  verificação automática silenciosa ao abrir o app (a versão disponível vira
  um banner no canto inferior direito; falhas de rede não incomodam), botão
  "Verificar atualizações" e exibição da versão instalada em
  **Configurações → Aplicativo**, download com progresso percentual e
  salvamento do rascunho em edição antes de instalar (no Windows o instalador
  encerra o app automaticamente). 13 testes novos (unit + componente).
- Guard de runtime: fora do app desktop (navegador com Vite) o updater fica
  inerte (`isTauriRuntime`).
- Seção "Manter o app atualizado" no guia do usuário; seções "Atualizações do
  app (updater)" e "Crash reporting" na política de privacidade.

**Alterado**
- Mensagens de erro de rede do updater traduzidas para orientação amigável
  ("sem conexão ou endpoint indisponível") em vez de jargão bruto.

**Infra/Docs**
- Secrets `TAURI_SIGNING_PRIVATE_KEY*` cadastrados no CI — `release.yml` agora
  gera artefatos de atualização assinados + `latest.json` em toda tag.
- GitHub Discussions habilitado no repositório (canal de suporte/comunidade
  do M4).
- Decisão registrada: **zero telemetria** (sem crash reporting), formalizada
  na política de privacidade.
- Extração do módulo `vault_metadata.rs` (lixeira + histórico) de `lib.rs`
  (−296 linhas) sem mudança de comportamento.

### Marco 8 — Frontmatter no header, motor único de leitura e E2E Linux

**Adicionado**
- Painel de frontmatter integrado ao cabeçalho da nota (edição das
  propriedades YAML sem sair do editor).
- Motor único de leitura: o modo Leitura passou a renderizar pelo Misto
  read-only, cobrindo links, imagens, embeds, callouts, HTML sanitizado,
  blocos de plugin, checkboxes, frontmatter colapsado, matemática (KaTeX) e as
  marcas de lacunas de revisão; o renderer clássico (ReactMarkdown) e o botão
  "Testar novo motor" foram removidos.
- Leitura unificada do vault: `read_vault_notes` devolve todos os conteúdos em
  uma única chamada IPC, com progresso em lotes; o grafo reutiliza o cache de
  conteúdos da indexação quando o conjunto de notas não mudou.
- E2E Linux no CI: smoke desktop com display virtual (`xvfb`) na jornada
  `create-save-reopen`.

### Marco P1 — Comparabilidade real, visão multimodal e custo da visão

**Adicionado**
- Comparabilidade entre provedores de IA no produto (avaliação lado a lado).
- Descrição de imagem (visão multimodal) com custo estimado por chamada
  (contabilizado no orçamento mensal de IA).

### Gate de release Windows e review V2

**Adicionado**
- Matriz de suporte Windows formalizada (11 22H2 x64 primário; 10 22H2 x64
  secundário) com checklist e procedimentos de validação de release.
- Fluxo de revisão completo (V2): prontidão, adesão, agendamento, fila,
  provas mistas (múltipla escolha + resposta curta), conversa, evidência de
  memória por tipo de pergunta, relatórios, dashboard e políticas por
  nota/tag/Vault.
- Durabilidade do aprendizado: escrita atômica, backups, recuperação e
  reconciliação de renomeações/movimentações externas.

### Marcos anteriores (consolidados)

**Adicionado**
- Grafo de conexões 2D/3D com física estilo Obsidian, agrupamento por
  pasta/tag e exportação (SVG/PNG).
- Bases (tabelas) com colunas configuráveis e filtros.
- Wikilinks: índice em memória, backlinks, autocomplete e atualização
  incremental em salva/rename/exclusão.
- Editor Markdown com CodeMirror, modos Edição/Misto/Leitura, live preview,
  matemática KaTeX, callouts e embeds.
- Vault local com watcher de arquivos, inventário, lixeira/restauração e
  compatibilidade com vaults Obsidian (configurações `.obsidian` e anexos).
- Janela sem decorações nativas com barra de título customizada e controles de
  janela na identidade do app.
- Verificação factual opcional ("Verificar Fatos") e auditoria estrutural
  determinística das notas.

## Futuro

As pendências de lançamento e o plano de consolidação estão em
`docs/launch-roadmap.md`; as pendências funcionais por área estão nos
roadmaps em `docs/` (`v2-features`, `unified-reader`, `review-learning*`).
