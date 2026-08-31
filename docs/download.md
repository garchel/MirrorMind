# Baixar o MirrorMind

O MirrorMind é distribuído pelos **GitHub Releases** do projeto
(`https://github.com/garchel/MirrorMind/releases`). Cada release publicada
(workflow `release.yml`, disparado por tags `v*`) anexa:

- `MirrorMind-<versao>-x64-setup.exe` — instalador **NSIS** (recomendado).
- `MirrorMind-<versao>-x64.msi` — pacote MSI (deploy gerenciado).
- `windows-bundle-manifest.json` — manifesto de validação do artefato.
- `latest.json` — manifesto de atualização assinado consumido pelo
  auto-updater do app (o aviso de nova versão aparece dentro do próprio app;
  não é necessário baixar nada manualmente para atualizar).

## Requisitos mínimos

- **Windows 10 22H2 x64** (build 19045) ou **Windows 11 22H2 x64**
  (build 22621). Arquiteturas x86 e ARM64 não são suportadas nesta versão.
- **WebView2 Runtime** (instalado automaticamente pelo instalador quando
  ausente).
- Disco NTFS (caminhos longos suportados).

## Instalação

1. Baixe o `*-setup.exe` da release desejada.
2. Execute o instalador e siga os passos.
3. Na primeira abertura, escolha um Vault existente ou crie um novo.

> **Assinatura**: quando o instalador estiver assinado (Authenticode), o
> Windows não exibe o aviso do SmartScreen. Enquanto a release não for
> assinada, o aviso pode aparecer — verifique o editor do arquivo antes de
> continuar.

## Notas

- **Seus dados não são tocados**: o app grava apenas dentro do Vault
  (`.mirmind/`) e uma preferência de Vault recente na pasta de configuração do
  app. Desinstalar não apaga Vaults nem notas.
- **Versões pré-release**: releases marcadas como *pré-release* são candidatas
  de teste; preferência pela última release estável.
- **Atualizações**: o app verifica sozinho se há versão nova ao abrir e
  oferece o download assinado dentro da própria interface (Configurações →
  Aplicativo → Verificar atualizações).
- Matriz de suporte completa: `docs/windows-support-matrix.md`.

## Suporte e documentação

- **Primeiros passos**: [Guia do usuário](user-guide.md).
- **Vindo do Obsidian?**: [Guia de migração](obsidian-migration-guide.md).
- **Bugs**: abra uma issue com o template *Report de bug*.
- **Sugestões**: template *Sugestão de melhoria* (ou GitHub Discussions).
