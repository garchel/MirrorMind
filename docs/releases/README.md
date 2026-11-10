# Releases — candidatas e validação

Este diretório guarda **uma pasta por release candidata**, com o checklist
preenchido e os logs da validação. O estado atual é: **nenhuma candidata foi
validada em máquina real ainda** (`docs/releases/` não existia antes deste
scaffold).

## Como abrir uma candidata

1. Duplique o checklist: `docs/release-checklist.md` →
   `docs/releases/<versao>-<YYYY-MM-DD>/CHECKLIST.md`.
2. Preencha a identificação (versão, commit, data, SO/build, artefato).
3. Rode, nesta ordem, e anexe a saída em `logs/`:
   - `npm run typecheck`
   - `npm run lint`
   - `npx vitest run`
   - `cargo test --manifest-path src-tauri/Cargo.toml --features e2e`
   - `cargo fmt --check`
   - `node tests/e2e/run-windows-e2e.mjs`
   - `npm run tauri build`
4. Execute as seções 1–4 do checklist na máquina real (instalação limpa,
   NTFS local, OneDrive sincronizado de verdade).
5. Só promova quando as seções obrigatórias estiverem verdes; registre os
   riscos aceitos.

## Estrutura

```
docs/releases/
  README.md                    (este arquivo)
  <versao>-<YYYY-MM-DD>/
    CHECKLIST.md               (cópia preenchida de docs/release-checklist.md)
    logs/                      (saídas de teste, build, E2E)
    ARTEFATO.md                (nome, sha256, assinatura, timestamp)
```

## O que depende de decisão ou de máquina

- **Assinatura Authenticode**: certificado e timestamp — decisão sua.
- **Publicação (tag + GitHub Release)**: `release.yml` existe por tag e a
  assinatura é condicional aos secrets; a primeira execução real ainda não
  aconteceu.
- **OneDrive real**: exige a sua conta e uma pasta sincronizada.
- **macOS**: não há build nem notarização; fora do escopo atual.

## Referências

- `docs/release-checklist.md` — template e critérios.
- `docs/release-validation-procedures.md` — passo a passo de instalação e
  validação.
- `docs/launch-roadmap.md` — o que falta para lançar, em ordem.
- `docs/windows-support-matrix.md` — matriz de SO suportado.
