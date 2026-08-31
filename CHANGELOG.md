# Changelog

Todas as mudanças notáveis do MirrorMind são documentadas neste arquivo. O
formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [SemVer](https://semver.org/lang/pt-BR/). A primeira
release pública ainda não foi feita; os marcos abaixo estão em
**Não publicado**.

## [Não publicado]

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
