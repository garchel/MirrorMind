# MirrorMind

App de notas **local-first** para Windows que transforma seu vault Markdown em
um sistema de revisão espaçada com IA. Suas notas são arquivos `.md` reais numa
pasta do seu computador — nada é enviado para servidores, nenhuma conta é
necessária (recursos de IA são opcionais).

![Tauri](https://img.shields.io/badge/Tauri-2-blue) ![React](https://img.shields.io/badge/React-19-blue) ![Rust](https://img.shields.io/badge/Rust-stable-orange) ![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-lightgrey)

## Destaques

- **Vault = pasta de arquivos reais.** Abra um vault existente (inclusive do
  Obsidian) ou crie um novo; sincronize com OneDrive, Git ou o serviço que
  preferir. Nada no seu disco é reformatado: preservação byte a byte
  (BOM, CRLF, Unicode NFC/NFD).
- **Editor com live preview** sobre CodeMirror 6: três modos (Edição, Misto e
  Leitura) com UM único motor de renderização — wikilinks clicáveis, callouts,
  tabelas GFM, matemática KaTeX, HTML sanitizado, embeds de notas e PDFs.
- **Grafo de conexões 2D/3D** com agrupamento por pasta/tag, filtros, exportação
  SVG/PNG e layout em Web Worker.
- **Revisão espacada com IA** (o diferencial): avaliação de prontidão da nota,
  agendamento FSRS-5 por parágrafo, prova objetiva corrigida deterministicamente
  ou conversa avaliada pela IA com citações literais obrigatórias da nota,
  relatórios com marca-texto das lacunas e verificação factual opcional.
- **Privacidade por desenho:** a chave de IA fica no cofre nativo do sistema,
  consentimento concedido em diálogo do SO, orçamento de custo mensal imposto
  antes de cada chamada, zero telemetria.

## Requisitos

- Windows 10 22H2 x64 ou Windows 11 x64.
- WebView2 Runtime (instalado automaticamente quando ausente).

## Instalação

Baixe o instalador mais recente na página de
[download](docs/download.md) (GitHub Releases: `*-setup.exe` NSIS recomendado).

## Primeiros passos

1. Abra o MirrorMind e escolha **abrir vault existente** ou **criar novo**.
2. Escreva em Markdown (`Ctrl+N` para nova nota; `Ctrl+M` alterna os modos).
3. Conecte ideias com `[[wikilinks]]`, tags e backlinks; explore pelo Grafo ou
   pela Tabela.
4. Opcional: configure Gemini ou Ollama local nas Configurações de IA e ative a
   revisão espaçada nas notas de estudo.

Guia completo: [docs/user-guide.md](docs/user-guide.md) ·
Migração do Obsidian: [docs/obsidian-migration-guide.md](docs/obsidian-migration-guide.md)

## Desenvolvimento

```bash
npm install          # dependências do frontend
npm run tauri:dev    # app desktop em modo dev
npm test             # testes frontend (Vitest)
npm run lint         # oxlint
npm run typecheck    # tsc
npm run test:ci:rust # testes Rust (cargo test)
npm run build        # build frontend
npm run build:desktop:bundle  # instalador NSIS + MSI
```

Estrutura:

| Pasta | Conteúdo |
|---|---|
| `src/` | Frontend React (workspace, editor, grafo, páginas) |
| `src/features/review/` | Domínio de revisão/aprendizado (frontend) |
| `src-tauri/src/` | Backend Rust (vault, watcher, IPC) |
| `src-tauri/src/review/` | Domínio de revisão (FSRS, provedores IA, persistência) |
| `docs/` | Roadmaps, guias e procedimentos de release |
| `tests/e2e/` | Jornadas E2E desktop (Windows/Linux) |

## Documentação

- [Roadmap de lançamento](docs/launch-roadmap.md)
- [Features V2](docs/v2-features-roadmap.md)
- [Revisão e aprendizado](docs/review-learning-roadmap.md) · [V2/plano pago](docs/review-learning-v2-roadmap.md)
- [Motor único de renderização](docs/unified-reader-roadmap.md)
- [Compatibilidade Obsidian](docs/common-note-app-features.md) · [contrato V1](docs/obsidian-v1-compatibility.md)
- [Testes](docs/testing-roadmap.md) · [Política de privacidade](docs/privacy-policy.md)

## Licença

Ainda não definida — ver [docs/launch-roadmap.md](docs/launch-roadmap.md) (item "Licença / identidade legal").
