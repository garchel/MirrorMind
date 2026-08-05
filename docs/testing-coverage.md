# Cobertura de Testes

Este documento descreve como reproduzir e interpretar a cobertura diagnostica do MirrorMind. Percentuais globais ainda nao reprovam a CI; limites serao definidos por modulo critico depois que o baseline estiver estabilizado nas plataformas suportadas.

## Versoes pinadas

- Node.js: `24.14.1`, em `.node-version`.
- Rust: `1.96.1`, em `rust-toolchain.toml`.
- Vitest e `@vitest/coverage-v8`: `4.1.10`.
- `cargo-llvm-cov`: `0.8.7`.

O toolchain Rust instala `llvm-tools-preview` e `rustfmt`. `cargo-llvm-cov` e uma ferramenta externa e precisa ser instalada uma vez na maquina local:

```powershell
cargo install cargo-llvm-cov --version 0.8.7 --locked
```

## Comandos locais

Frontend:

```powershell
npm ci
npm run test:coverage:frontend
```

Saidas:

- `coverage/frontend/coverage-summary.json`
- `coverage/frontend/lcov.info`
- resumo no terminal

Rust:

```powershell
npm run test:coverage:rust
New-Item -ItemType Directory -Force coverage/rust | Out-Null
cargo llvm-cov report --manifest-path src-tauri/Cargo.toml --lcov --output-path coverage/rust/lcov.info
```

Saidas:

- `coverage/rust/lcov.info`
- resumo de linhas, regioes e funcoes no terminal

## Fotografia inicial

Medicao local em `2026-07-15`, no Windows, sobre o working tree baseado em `e2339b2`:

| Stack | Linhas | Branches | Regioes | Funcoes |
| --- | ---: | ---: | ---: | ---: |
| Frontend V8 | 65,12% | 56,15% | N/A | 53,05% |
| Rust estavel | 71,36% | Indisponivel | 73,33% | 51,33% |

Esta e uma fotografia, nao um limite comparavel entre sistemas operacionais. Codigo condicional e toolchains diferentes alteram numerador e denominador. O artefato de cada execucao da CI fica associado ao commit correspondente e sera a fonte para comparacoes futuras.

Branch coverage Rust exige nightly e continua oficialmente instavel no `cargo-llvm-cov`; por isso o gate estavel mede linhas, regioes e funcoes. O frontend mede branches com o provider V8.

## Escopo

- Frontend: arquivos produtivos `src/**/*.{ts,tsx}`.
- Excluidos: testes, declaracoes `.d.ts` e setup do Vitest.
- Rust: crates e features do workspace em `src-tauri`, incluindo `lib.rs` e `main.rs`.
- Fora do escopo: CSS, assets, configuracoes declarativas e comportamento do WebView/binario desktop. Essas camadas exigem regressao visual, build e E2E.

## CI

O job `Coverage diagnostics` roda em paralelo ao gate convencional. Ele preserva relatorios parciais mesmo se uma das stacks falhar, valida separadamente os tres arquivos obrigatorios e publica o artefato `coverage-ubuntu` por 14 dias.
