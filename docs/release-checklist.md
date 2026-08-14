# Checklist de release (Marco 7)

Cada release candidata deve preencher este checklist e anexar o resultado ao
commit/tag da release. Ele registra SO, arquitetura, artefato, jornadas
executadas, resultados e riscos aceitos — a task "Checklist de release" do
`testing-roadmap.md`.

## Como usar

1. Duplique este arquivo como `release-checklist-<versao>-<data>.md` (ex.:
   `release-checklist-0.1.0-2026-08-20.md`) em `docs/releases/`.
2. Preencha cada secao com os valores reais da validacao.
3. Anexe os artefatos de log (test-results) quando existirem.
4. A release so e promovida com todas as secoes obrigatorias verdes.

## Identificacao da release

| Campo | Valor |
| --- | --- |
| Versao do app | (ex.: 0.1.0) |
| Commit | (hash) |
| Data da validacao | (ISO) |
| SO / build | (ex.: Windows 11 22H2 build 22621 x64) |
| Artefato | (caminho do instalador assinado `.exe` / `.msi`) |
| Assinatura | (certificado Authenticode usado; timestamp) |
| Build E2E? | (sim/nao — o artefato de release NAO e o build E2E) |

## 1. Matriz Windows (obrigatorio)

- [ ] Versao minima documentada em `docs/windows-support-matrix.md` (Windows 11
      22H2 x64 primario; Windows 10 22H2 x64 secundario).
- [ ] A maquina de validacao atende ao minimo (Windows 11 22H2 x64).
- [ ] Arquitetura validada: x64.
- [ ] (Se aplicavel) Windows 10 22H2 validado como compatibilidade secundaria.

## 2. Instalacao limpa (obrigatorio)

Executado em maquina limpa (VM descartavel ou maquina sem instalacoes
anteriores do MirrorMind).

- [ ] Instalador assinado instalado sem SmartScreen/Smart App Control bloqueando.
- [ ] Primeira abertura: tela de boas-vindas + escolha de Vault.
- [ ] Criar um Vault de teste com ao menos uma nota.
- [ ] Fechar e reabrir: Vault recente reabre (ou pergunta de reabertura).
- [ ] Reinstalacao (instalador por cima): Vault e notas intactos.
- [ ] Desinstalacao: Vaults do usuario (fora do appdata) NAO sao apagados.
  - O app grava somente a preferencia de Vault recente em `app_config_dir`
    (`recent-vault.json`) e todo o resto dentro do proprio Vault (`.mirmind`);
    a desinstalacao nao deve tocar em pastas de dados do usuario.
- [ ] Apos desinstalar e reinstalar, um Vault anterior ainda abre corretamente.

## 3. Vault NTFS local (obrigatorio)

- [ ] Jornadas criticas do E2E passam em disco local (CI/nightly).
- [ ] Caminho curto: nota na raiz do Vault salva e reabre.
- [ ] Caminho longo (>260 chars): coberto por
  `windows_path_suite_writes_and_reopens_a_path_longer_than_max_path`.
- [ ] Unicode (NFC/NFD) em conteudo e nomes:
  `obsidian_matrix_unicode_nfc_nfd_round_trips`.
- [ ] Arquivo aberto por outro processo (lock de escrita): coberto por
  `save_never_truncates_a_note_locked_by_another_process` — o save falha com
  erro claro, sem truncar/gravar bytes parciais; apos liberar, salva
  normalmente.
- [ ] Autosave e conflito de rascunho (jornada `external-change-conflict`).

## 4. Vault sincronizado pelo OneDrive (obrigatorio)

Validado em pasta REALMENTE sincronizada pelo cliente OneDrive (nunca por env
fingido — o app usa a API de pastas conhecidas).

- [ ] Abrir Vault dentro da pasta OneDrive sincronizada.
- [ ] Autosave: nota salva localmente e propaga para a nuvem.
- [ ] Conflito: editar concorrentemente (app + outro processo) nao sobrescreve
      silenciosamente; banner de conflito aparece.
- [ ] Renomeacao/movimentacao com atualizacao de links em pasta sincronizada.
- [ ] Restauracao (lixeira do app) em pasta sincronizada.
- [ ] Arquivos ainda nao materializados (placeholder/offline): abrir a nota
      dispara a materializacao pelo OneDrive e o app continua operando (nao
      trava; diagnostico de leitura parcial cobre o caso).
- [ ] (Aceito) latencia de propagacao da nuvem nao e coberta por timeout E2E;
      o teste e manual nesta maquina.

## 5. Jornadas E2E executadas (obrigatorio)

| Jornada | Spec | Resultado |
| --- | --- | --- |
| Criar, salvar e reabrir | `create-save-reopen.e2e.mjs` | (pass/fail + logs) |
| Renomear/mover com links | `rename-move-links.e2e.mjs` | |
| Lixeira e restauracao | `trash-restore.e2e.mjs` | |
| Mudanca externa/conflito | `external-change-conflict.e2e.mjs` | |
| Abandono de sessao | `session-abandon.e2e.mjs` | |
| Abrir Vault Obsidian | `open-obsidian-vault.e2e.mjs` | |
| Falha segura | `safe-failure.e2e.mjs` | |
| Anexo completo | `attachment-complete.e2e.mjs` | |
| Configuracoes persistentes | `settings-persistence.e2e.mjs` | |

- [ ] Suite completa rodada de ponta a ponta (runner oficial
      `tests/e2e/run-windows-e2e.mjs`).
- [ ] Registros em `test-results/e2e/` anexados/arquivados.

## 6. Testes e builds (obrigatorio)

- [ ] Rust: `cargo test --manifest-path src-tauri/Cargo.toml --features e2e`
      (contagem pass/fail).
- [ ] Frontend: `npm run typecheck` + `npx vitest run` (contagem).
- [ ] Lint: `npm run lint` (0 erros).
- [ ] `cargo fmt --check` limpo.
- [ ] Build desktop de release (`npm run tauri build`) sem erros.

## 7. Riscos aceitos

| Risco | Aceito? | Mitigacao |
| --- | --- | --- |
| (ex.: ARM64 sem validacao) | sim | fora do escopo da release; monitorar |
| (ex.: OneDrive placeholder em arquivo grande) | sim | diagnostico de leitura parcial + banner |

## Assinatura da release

- Validado por: (nome/data)
- Aprovado para release: (sim/nao, data)
