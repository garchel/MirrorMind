# Roadmap de lançamento (Launch)

Objetivo deste documento: definir **o que falta, em que ordem e com quais
critérios** para lançar o MirrorMind como produto utilizável por outras
pessoas — começando por um **beta local-first no Windows x64** (decisão formal
do Marco 7, ver `docs/windows-support-matrix.md`).

Ele complementa os documentos existentes:

- `docs/release-checklist.md` — o gate de validação por candidata a release.
- `docs/release-validation-procedures.md` — como executar as validações manuais.
- `docs/windows-support-matrix.md` — alvos suportados (Windows 11 22H2 x64
  primário; Windows 10 22H2 x64 secundário; ARM64 fora do escopo).
- Roadmaps de funcionalidade (`v2-features`, `unified-reader`,
  `review-learning*`) — pendências funcionais que NÃO bloqueiam o beta.

## Estado atual (snapshot)

| Área | Estado | Observação |
| --- | --- | --- |
| Build desktop | ✅ Pronto | Tauri 2, NSIS + MSI, ícones, CSP, janela sem decoração com controles customizados |
| CI | ✅ Pronto | Lint, typecheck, 749 testes frontend, 489 testes Rust, build, E2E desktop Windows (9 jornadas), bundle + smoke, cobertura |
| E2E Linux smoke | ✅ Pronto | Job dedicado no CI (`linux-e2e-smoke`) |
| Gate de release (checklist) | ❌ Nunca executado | `docs/releases/` não existe; nenhuma candidata validada em máquina real |
| Assinatura de código | ❌ Ausente | Instalador gerado sem Authenticode; SmartScreen bloqueia instalação limpa |
| Automação de release | 🟡 Parcial | `release.yml` por tag criado (assinatura condicional aos secrets); aguarda primeira execução/validação com tag real |
| Licença / identidade legal | ❌ Ausente | `Cargo.toml` com `license = ""`; sem `LICENSE` (`CHANGELOG.md` já existe) |
| Distribuição | 🟡 Parcial | Página de download documentada (`docs/download.md`); nenhum GitHub Release publicado |
| Multiplataforma | 🟡 Parcial | Windows x64 validado; Linux só smoke; macOS sem build nem notarização |
| Auto-updater (atualizações automáticas) | 🟡 Infra pronta | Plugin updater registrado, pubkey gerada e endpoint apontando para GitHub Releases (`latest.json`); `release.yml` já gera artefatos de atualização assinados (`createUpdaterArtifacts` + manifesto) quando o secret está presente. Faltam: cadastrar `TAURI_SIGNING_PRIVATE_KEY*` nos secrets do CI, executar/validar o workflow com tag real e o fluxo de verificação de atualização na UI |
| Documentação de usuário | 🟡 Parcial | `docs/user-guide.md` + `docs/obsidian-migration-guide.md` criados e linkados da página de download; falta revisão de conteúdo por quem conhece o produto ponta a ponta |
| Suporte / comunidade | 🟡 Parcial | Templates de issue (*Report de bug* / *Sugestão*) criados; falta habilitar GitHub Discussions (configuração do repositório) |
| Telemetria de falhas (crash reporting) | ❌ Sem decisão | Filosofia local-first sugere "não ter", mas a decisão não está registrada nem justificada |

## Princípios

1. **Windows x64 é a porta de entrada.** Tudo abaixo prioriza um beta sólido
   no Windows; Linux/macOS são consolidações posteriores.
2. **Dados do usuário são sagrados.** Nenhuma mudança pode arriscar vaults,
   notas ou aprendizado (o gate de desinstalação/reinstalação cobre isso).
3. **Todo marco tem critério de saída objetivo**, não "está bom". Release só
   promove com o checklist verde.
4. **Local-first primeiro.** A oferta gerenciada por assinatura (IA no
   backend) é V2 e não bloqueia o lançamento.

## Marcos

### M0 — Congelamento de código e gate automático (pré-requisito)

**Objetivo**: garantir que a base está verde e reprodutível antes de gastar
tempo em validação manual.

| Task | Esforço | Status |
| --- | --- | --- |
| CI verde no branch de release (lint, typecheck, testes frontend/Rust, E2E Windows completo) | S | ✅ já roda |
| `cargo fmt --check` limpo e incluído no CI | S | ✅ adicionado (script `npm run fmt:check` + passo no CI) |
| Bundle de release (`npm run build:desktop:bundle`) gera NSIS + MSI sem erros | S | ✅ já roda no CI |
| Decidir versão de lançamento (ex.: 0.1.0-beta) e criar branch/tag de candidata | S | 🟡 decisão |

**Critério de saída**: uma corrida completa do CI na candidata termina verde,
com E2E Windows completo e artefato NSIS reproduzível.

### M1 — Gate de release em máquina real (BLOQUEANTE)

**Objetivo**: executar o checklist do Marco 7 em hardware real e preencher
`docs/release-checklist-0.1.0-<data>.md` (template em
`docs/release-checklist.md`).

| Task | Esforço | Status |
| --- | --- | --- |
| Instalação limpa em Windows 11 22H2 x64 (VM descartável) | M | ❌ |
| Criar vault, salvar nota, fechar/reabrir (vault recente) | S | ❌ |
| Reinstalar por cima + desinstalar + reinstalar sem perder vaults/notas | M | ❌ |
| Vault em OneDrive REAL: autosave, conflito, rename com links, restauração, placeholder não materializado | M | ❌ |
| Preencher e anexar o checklist com riscos aceitos | S | ❌ |

**Critério de saída**: checklist preenchido com todas as seções obrigatórias
verdes e assinado. **Sem isso, não existe candidata a release.**

### M2 — Assinatura de código Authenticode (BLOQUEANTE)

**Objetivo**: instalar sem SmartScreen/Smart App Control bloqueando.

| Task | Esforço | Status |
| --- | --- | --- |
| Adquirir certificado de assinatura de código (OV é o mínimo aceitável; EV remove restrições) | M (externo) | ❌ |
| Configurar o signing do instalador NSIS/MSI no pipeline (ex.: Azure Trusted Signing, certificado em secret) | M | ❌ |
| Validar: assinatura presente, timestamp, SmartScreen limpo na VM do M1 | S | ❌ |

**Critério de saída**: instalador assinado instala em máquina limpa sem
bloqueio do SmartScreen/Smart App Control.

### M3 — Automação de release por tag (BLOQUEANTE)

**Objetivo**: publicar candidatas de forma repetível, sem depender de máquina
local.

| Task | Esforço | Status |
| --- | --- | --- |
| Workflow `release.yml` disparado por tag `v*`: build de release → assinar → publicar GitHub Release com NSIS + MSI + manifest | M | ✅ criado (`.github/workflows/release.yml`); assinatura condicional aos secrets; aguarda primeira tag |
| Changelog gerado a partir dos marcos (notas de release) | S | ✅ `CHANGELOG.md` criado; o release usa `--generate-notes` por tag |
| Retenção/expiração dos artefatos de CI desacoplada da distribuição oficial | S | ✅ release publica via `gh release` (fora dos artefatos de CI); CI mantém só diagnósticos |

**Critério de saída**: `git push --tags` gera um GitHub Release com o
instalador assinado e notas, sem intervenção manual.

### M4 — Itens legais e de produto (BLOQUEANTE para lançamento público)

**Objetivo**: identidade legal e canais de distribuição prontos.

| Task | Esforço | Status |
| --- | --- | --- |
| Definir licença (ex.: MIT) e adicionar `LICENSE` + `license` no `Cargo.toml`/`package.json` | S | ❌ decisão sua |
| Política de privacidade e termos de uso (descreve o que o app grava: só `.mirmind/` dentro do vault + `recent-vault.json`) | S | ✅ rascunho `docs/privacy-policy.md` (revisar antes de publicar) |
| Página de download (GitHub Releases) com instruções de instalação e requisitos mínimos | S | ✅ `docs/download.md` |
| Identidade visual mínima no instalador (ícone do app já gerado; conferir NSIS) | S | ✅ ícones gerados da logo; NSIS usa o bundle padrão |
| Onboarding de primeiro uso: tela de boas-vindas + escolha/criação de Vault guiada | M | 🟡 a tela existe (hero + abrir/criar + modal de vault recente) e recebeu copy de produto (textos de dev removidos); validar jornada completa no gate M1 |
| Guia do usuário mínimo: primeiros passos + guia de migração do Obsidian (público, fora de `docs/` interno) | M | ✅ `docs/user-guide.md` + `docs/obsidian-migration-guide.md`, linkados de `download.md` |
| Canal de suporte/comunidade mínimo: GitHub Discussions habilitado + templates de issue (bug/feedback) | S | 🟡 `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_feedback.yml` criados; habilitar Discussions é configuração do repositório |

**Critério de saída**: download público leva a um instalador assinado com
termos/privacidade acessíveis e instalação sem fricção, e um usuário novo
consegue dar os primeiros passos sem apoio externo (onboarding + guia).

### M5 — Pós-lançamento (consolidação, NÃO bloqueia o beta)

**Objetivo**: ampliar alcance e fechar pendências funcionais conhecidas, em
ordem de valor.

| Task | Esforço | Prioridade |
| --- | --- | --- |
| **Auto-updater**: plugin updater do Tauri + feed de versões assinado + política de notificação de atualização | M | **alta** — 🟡 INFRA PRONTA (2026-08): `tauri-plugin-updater` registrado em `lib.rs`, capability `updater:default`, pubkey em `tauri.conf.json` com endpoint GitHub Releases; keypair gerado em `src-tauri/updater-keys/` (**chave privada gitignored — guardar em cofre/secret antes de qualquer release**); `release.yml` já condiciona `createUpdaterArtifacts` + geração do `latest.json` à presença do secret. Restam: cadastrar o secret `TAURI_SIGNING_PRIVATE_KEY*` no CI, primeira execução/validação com tag real e verificação de atualização na UI |
| Registrar DECISÃO sobre telemetria de falhas (crash reporting): manter zero-telemetria local-first e documentar em `privacy-policy.md`, ou adotar relatório opt-in de crashes | S | **alta** — hoje um crash do app é invisível para o time; a decisão (mesmo sendo "não ter") precisa estar escrita |
| Auditoria de segurança externa do código Rust/TypeScript (foco: IPC, confinamento de vault, TOCTOU, egresso de IA) | L | média |
| Modelo geral de monetização/licenciamento do produto (hoje só o plano pago da IA tem escopo) | S (decisão) + M (implementação) | média |
| Linux: distributivos (AppImage/deb/rpm) no CI + validação real | M | média |
| macOS: build + assinatura/notarização | M | média |
| Compatibilidade de anexos: realocação/antecipação `./pasta`, matriz maior de vaults (v2-features, item `Parcial`) | M | baixa |
| Decisões do leitor unificado: copiar/selecionar no Leitura, preview de wikilink no hover, embeds assíncronos, links externos | M | baixa |
| Oferta gerenciada por assinatura (IA no backend, custos por conta — review-learning-v2) | L | baixa |
| ARM64 (monitoramento) | S | baixa |

## Dependências entre marcos

```
M0 (base verde)
 └─► M1 (gate manual) ──► M2 (assinatura) ──► M3 (automação) ──► M4 (legal/distribuição) ──► LANÇAMENTO BETA
                                                                    └─► M5 (consolidação, em paralelo depois)
```

- M1 e M2 são independentes entre si (podem rodar em paralelo).
- M3 depende do artefato assinado (M2) para publicar a versão oficial.
- M5 começa DEPOIS do lançamento do beta; itens dele podem ser preparados
  antes sem comprometer os marcos bloqueantes.

## Decisões que dependem de você

1. **Licença** do projeto (M4) — MIT é o caminho de menor atrito.
2. **Escopo do lançamento**: só Windows (recomendado) ou incluir Linux já no
   beta.
3. **Nome/versão**: manter `MirrorMind 0.1.0-beta` ou ajustar.
4. **Certificado de assinatura**: provedor e custo aceito (M2).
5. **Onde distribuir**: GitHub Releases, site próprio ou ambos (M4).
6. **Crash reporting**: manter zero-telemetria (documentar a escolha) ou
   adotar relatório opt-in de falhas (M5).
7. **Monetização geral**: modelo/licença comercial do produto além do plano
   pago da IA (M5).

## Registro de mudanças

- **2026-08**: criado a partir do diagnóstico de prontidão (estado da CI, do
  gate e das pendências de funcionalidade). Revisar a cada marco concluído.
- **2026-08 (implementação)**: M0 `fmt` no CI; M3 `release.yml` + `CHANGELOG`;
  M4 rascunho de privacidade e página de download. Restam as decisões (M0
  versão; M2 certificado; M4 licença) e o gate manual (M1).
- **2026-08 (implementação das lacunas autônomas)**: guias de usuário criados
  (`user-guide.md`, `obsidian-migration-guide.md`) e linkados da página de
  download; templates de issue bug/sugestão adicionados; copy da tela de
  boas-vindas reescrita em linguagem de produto; infraestrutura do auto-updater
  instalada (plugin, capability, pubkey/endpoint, keypair local gitignored).
- **2026-08 (lacunas de produto)**: auditoria cruzada dos backlogs identificou
  itens fora de qualquer roadmap e foram registrados aqui. Snapshot corrigido
  (changelog existia; release.yml/download já criados). M4 ganhou onboarding,
  guia do usuário/migração Obsidian e canal de suporte. M5 ganhou auto-updater
  (prioridade alta), decisão formal de crash reporting, auditoria de segurança
  externa e modelo geral de monetização. Regressão visual e criptografia
  opcional de vault registradas em `v2-features-roadmap.md` (Bloco V2.2);
  riscos correspondentes anotados em `testing-roadmap.md`.
