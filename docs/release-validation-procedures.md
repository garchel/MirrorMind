# Procedimentos de validacao do Marco 7

Este documento detalha como executar as validacoes manuais do gate de release
em Windows real: instalacao limpa e Vault sincronizado pelo OneDrive. As
validacoes automatizaveis (NTFS local, caminhos longos, Unicode, lock de
arquivo) tem testes dedicados e ficam na CI/nightly — os procedimentos abaixo
sao os passos em maquina real que o checklist de release referencia.

## O que o app grava fora do Vault

Para dimensionar a instalacao limpa, e importante saber onde o app grava dados:

| Onde | O que | Persistencia |
| --- | --- | --- |
| Dentro do Vault (`.mirmind/`) | config, historico, indice de wikilinks, uso de IA, estado de revisao, lixeira | Destruido junto com o Vault (nunca pelo instalador) |
| `app_config_dir` (ex.: `%APPDATA%\com.mirrormind.desktop`) | `recent-vault.json` (preferencia de Vault recente) e configuracoes de notificacao | A desinstalacao do app nao remove esta pasta por padrao (NSIS remove o app, nao os dados de configuracao) |
| `app_local_data_dir` (WebView2) | perfil do WebView2 (localStorage) | Recriado na primeira abertura |

**Consequencia para o gate:** os Vaults do usuario ficam fora do appdata e o
app nunca escreve conteudo de notas fora deles. A desinstalacao nao pode perder
Vaults porque eles nunca sao movidos/copiados para o appdata — o instalador
apenas remove o binario e, opcionalmente, a configuracao do app (nao as pastas
do usuario).

## Procedimento: instalacao limpa

Requisitos: maquina/VM limpa (sem instalacoes anteriores do MirrorMind),
Windows 11 22H2 x64, instalador assinado (`.exe` NSIS).

1. **Instalar** o instalador assinado. Verificar que o SmartScreen/Smart App
   Control nao bloqueia (assinatura valida). Instalar para o usuario atual.
2. **Primeira abertura**: tela de boas-vindas; criar um Vault de teste com uma
   nota (`teste.md`) e salva-la.
3. **Fechar e reabrir**: confirmar que o Vault recente reabre (ou a pergunta
   de reabertura aparece). Conferir que `recent-vault.json` foi criado em
   `app_config_dir`.
4. **Reinstalar por cima**: rodar o instalador novamente sem desinstalar.
   Abrir e confirmar que o Vault e a nota continuam intactos.
5. **Desinstalar**: executar o desinstalador. Confirmar que:
   - o app sai do menu Iniciar / Programas;
   - a pasta do Vault de teste continua existindo com `teste.md` intacto;
   - `recent-vault.json` pode permanecer (dado do usuario) ou ser removido
     conforme o desinstalador — o que NAO pode acontecer e apagar a pasta do
     Vault.
6. **Reinstalar apos desinstalar**: instalar de novo e abrir o mesmo Vault —
   deve reabrir sem erro (mesmo que `recent-vault.json` tenha sido removido,
   o usuario escolhe o Vault de novo).

Criterio de aceite: nenhum dos passos perde Vaults, notas ou conteudo; a
desinstalacao nao apaga pastas de dados do usuario.

## Procedimento: Vault sincronizado pelo OneDrive

Requisitos: conta com OneDrive ativo e pasta realmente sincronizada (nunca
fingida via env — o app resolve a pasta do usuario pela API de pastas
conhecidas do Windows).

1. **Abrir**: colocar/abrir um Vault dentro da pasta OneDrive sincronizada.
   Confirmar que o inventario aparece completo.
2. **Autosave**: ativar autosave (configuracoes) e editar uma nota; confirmar
   que o arquivo local atualiza e que o OneDrive propaga (icone de nuvem
   alterna para "sincronizado").
3. **Conflito**: com a nota aberta no app, editar o MESMO arquivo por outro
   processo/editor e salvar; voltar ao app e salvar — o banner de conflito de
   rascunho deve aparecer (nunca sobrescrita silenciosa). Coberto
   automaticamente pela jornada `external-change-conflict` no disco local; aqui
   o foco e a concorrencia com o cliente OneDrive.
4. **Renomeacao/movimentacao**: renomear/mover uma nota com links; conferir
   que os wikilinks atualizam e a mudanca propaga para a nuvem.
5. **Restauracao**: mover uma nota para a lixeira do app e restaurar; conferir
   que a restauracao funciona em pasta sincronizada.
6. **Arquivo nao materializado**: com uma nota grande/PDF ainda como
   placeholder (offline), abrir a nota no app — a leitura deve disparar a
   materializacao pelo OneDrive e o app nao deve travar; se a leitura falhar,
   o diagnostico de leitura parcial deve aparecer (banner, nunca silencio).

Criterio de aceite: abertura, autosave, conflito, renomeacao e restauracao
funcionam em pasta realmente sincronizada; falhas de materializacao sao
reportadas (banner), nunca apresentadas como inventario completo.

## Riscos aceitos esperados

| Risco | Aceite | Mitigacao |
| --- | --- | --- |
| Latencia de propagacao do OneDrive | sim | testes manuais sem timeout E2E na nuvem |
| Placeholder de arquivo grande sob carga | sim | diagnostico de leitura parcial + banner |
| ARM64 / x86 | sim | fora da matriz; monitorar |

## Registro

Cada execucao preenche `docs/release-checklist-<versao>-<data>.md` (template em
`docs/release-checklist.md`) com os resultados e riscos aceitos.
