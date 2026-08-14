# Matriz de suporte Windows

Decisao formal do **Marco 7** (gate de release em Windows real): versao minima,
arquiteturas, instalador e canais de validacao. Este documento e a fonte da
verdade para a task "Matriz Windows suportada" do `testing-roadmap.md`.

## Versao minima

| Alvo | Versao minima | Observacoes |
| --- | --- | --- |
| **Windows 11 x64** | 22H2 (build 22621) | Alvo primario da release; e a versao usada nas validacoes do Marco 7. |
| Windows 10 x64 | 22H2 (build 19045) | Suportado como compatibilidade secundaria; nao bloqueia release. |
| ARM64 (Windows 11) | nao suportado nesta release | O build desktop nao e validado em ARM64; WebView2/tauri podem funcionar, mas sem garantia ate a task "Arquiteturas Apple"/plataformas ARM ser validada. |

Decisoes tecnicas que fundamentam o minimo:

- **WebView2 Runtime**: o app depende do WebView2 (Tauri v2). O runtime e
  embarcado/solicitado pelo instalador; o minimo documentado e o runtime
  estavel disponivel para Windows 10 22H2/Windows 11.
- **NTFS como filesystem de suporte**: caminhos longos (>260) sao cobertos por
  teste dedicado (`windows_path_suite_writes_and_reopens_a_path_longer_than_max_path`),
  exigindo a politica de caminhos longos habilitada pelo processo (o app usa a
  API `\\?\` indiretamente via `canonicalize`/std no Windows).
- **Assinatura**: o instalador deve ser assinado (Authenticode) antes do
  gate de release — sem assinatura, SmartScreen bloqueia a instalacao limpa.

## Arquiteturas declaradas

- **x64 (AMD64)**: unica arquitetura validada e suportada nesta release.
- x86 (IA32): nao suportado.
- ARM64: nao suportado nesta release (item de monitoramento).

## Instalador

O bundle do Tauri (`src-tauri/tauri.conf.json`, `bundle.targets: "all"`) gera
no Windows:

- **NSIS**: instalador `.exe` usado para instalacao limpa, reinstalacao e
  desinstalacao no Marco 7.
- **MSI**: pacote `.msi` para deploy gerenciado (intune/GPO), validado
  secundariamente.

O identificador do app e `com.mirrormind.desktop`; o build E2E usa
`com.mirrormind.desktop.e2e` e e excluido do gate de release.

## Canais de validacao

| Canal | Windows |
| --- | --- |
| Pull request | Testes completos, build desktop e E2E critico obrigatorios (CI). |
| Nightly | E2E completo e casos caros de filesystem (caminhos longos, Unicode, lock). |
| Release candidata | CI verde + aceitacao em maquina real e OneDrive (Marco 7). |

## Registro de mudancas

- **2026-08**: decisao inicial (Windows 11 22H2 x64 primario; Windows 10 22H2
  x64 secundario; ARM64 fora do escopo). Revisar quando o instalador assinado
  e a validacao em maquina limpa concluirem o Marco 7.
