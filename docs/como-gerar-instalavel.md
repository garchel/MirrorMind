# Como gerar uma versao instalavel do MirrorMind (Windows)

Este documento descreve os DOIS caminhos: gerar um instalador local para uso
proprio, e publicar uma release oficial. O primeiro e o que se usa no dia a dia.

## Resumo rapido (uso proprio)

```bash
# 1. fechar o app se estiver rodando
taskkill //F //IM mirrormind.exe

# 2. build do frontend (tsc + vite)
npm run build

# 3. build Rust + geracao dos instaladores NSIS e MSI
npx tauri build --bundles nsis,msi
```

Tempo tipico em maquina local: 10 a 30 minutos (o primeiro build compila todas
as dependencias Rust; os seguintes sao muito mais rapidos por causa do cache).

### Onde ficam os instaladores

```
src-tauri/target/release/
  mirrormind.exe                      <- o executavel
  bundle/nsis/MirrorMind_<versao>_x64-setup.exe   <- INSTALADOR (use este)
  bundle/msi/MirrorMind_<versao>_x64.msi          <- instalador MSI (alternativa)
```

Use o `*-setup.exe` (NSIS). Ele e o instalador padrao do Windows, cria atalhos,
registra a desinstalacao e e o mesmo formato que o auto-updater espera.

### Instalar

Duplo clique no `*-setup.exe`. Como o build local NAO tem assinatura
Authenticode, o Windows pode mostrar o aviso do SmartScreen:

> "O Windows protegeu o seu computador" / "Windows protegeu o seu PC"

Isso e esperado. Clique em **"Mais informacoes"** e depois **"Executar assim
mesmo"**. O aviso aparece porque o binario nao esta assinado, nao porque ha
problema com ele.

## O que o build faz

O `npx tauri build` executa, nesta ordem:

1. `npm run build` (o `beforeBuildCommand` do `tauri.conf.json`) — `tsc -b` para
   checar tipos, depois `vite build` para gerar o `dist/`.
2. `cargo build --release` — compila o nucleo Rust em `src-tauri/`.
3. Gera os bundles configurados em `bundle.targets` do `tauri.conf.json`.

Se o passo 1 falhar (erro de TypeScript, por exemplo), o build para antes de
compilar o Rust.

## Flags uteis

| Comando | Quando usar |
| --- | --- |
| `npx tauri build --bundles nsis` | So o instalador NSIS (mais rapido que NSIS+MSI) |
| `npx tauri build --debug` | Build de depuracao (mais rapido, binario maior e sem otimizacao) |
| `npm run build:desktop:bundle` | Atalho do projeto para NSIS apenas |
| `npx tauri build --no-bundle` | So compilar, sem gerar instalador |

Para builds repetidos, o cache do Cargo ja evita recompilar dependencias. O
`npm run build` do frontend e sempre reexecutado.

## Versao

A versao fica em **dois** lugares e precisa bater:

- `src-tauri/tauri.conf.json` -> `"version"`
- `package.json` -> `"version"`

Atualmente ambos em `0.1.0`. O nome do instalador sai de la
(`MirrorMind_<versao>_x64-setup.exe`).

O workflow de release (`.github/workflows/release.yml`) sobrescreve a versao do
`tauri.conf.json` a partir da tag (`v0.1.0` -> `0.1.0`) no momento do build.

## Publicar uma release oficial

O caminho oficial e por **tag**, que dispara o workflow `release.yml`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

O workflow roda o gate completo (lint, fmt, typecheck, testes frontend, testes
Rust, E2E de desktop), gera NSIS + MSI, roda o smoke test do bundle
(`scripts/verify-windows-bundle.ps1`), assina quando os secrets estao
configurados e cria a GitHub Release com os artefatos.

Requisitos para a release assinada:

- `TAURI_SIGNING_PRIVATE_KEY` + senha -> gera os artefatos do auto-updater.
- `WINDOWS_CERT_BASE64` + senha -> assinatura Authenticode no instalador.

Sem esses secrets o build acontece, porem sem assinatura e sem auto-updater.

O checklist completo de validacao manual esta em
[docs/release-checklist.md](release-checklist.md).

## Observacao sobre o auto-updater

O `tauri.conf.json` aponta o updater para
`https://github.com/garchel/MirrorMind/releases/latest/download/latest.json`.

O instalador gerado localmente, sem `createUpdaterArtifacts`, nao verifica
atualizacao automatica de forma produtiva — isso exige a release publicada com
o `latest.json`. Para uso proprio local, basta recompilar quando houver
mudanca.
