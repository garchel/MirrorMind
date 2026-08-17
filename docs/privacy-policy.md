# Política de privacidade — MirrorMind

> **Rascunho para revisão.** Este documento descreve o comportamento REAL do
> app (fonte: `docs/release-validation-procedures.md` e roadmaps de revisão).
> Antes da publicação, revisar com apoio jurídico e ajustar para o canal de
> distribuição e a legislação aplicável (ex.: LGPD).

## Resumo

O MirrorMind é um aplicativo de **notas local-first**: seus arquivos Markdown e
seus dados ficam no seu computador, dentro do Vault que você escolhe. O app não
cria conta, não coleta telemetria e não transmite conteúdo de notas por padrão.

## 1. O que o app armazena e onde

| Onde | O que | Observação |
| --- | --- | --- |
| Dentro do Vault (`.mirmind/`) | Configuração, histórico, índice de wikilinks, uso de IA, estado de aprendizado/revisão, lixeira | Vive junto com as suas notas; é destruído junto com o Vault (nunca pelo instalador) |
| Pasta de configuração do app (`%APPDATA%\com.mirrormind.desktop`) | `recent-vault.json` (preferência de Vault recente) e preferências de notificação | Não contém conteúdo de notas |
| Pasta de dados locais do app (perfil WebView2) | Dados de interface (ex.: localStorage com preferências do app) | Recriado na primeira abertura |

Os seus arquivos `.md` e anexos **nunca** são movidos ou copiados para fora do
Vault pelo app. A desinstalação remove o programa e não apaga Vaults, notas ou
conteúdo do usuário.

## 2. IA (opcional, sob seu controle)

Recursos de IA (avaliação de prontidão, revisão, verificação de fatos, visão)
são **opcionais** e só rodam quando você aciona cada operação. O provedor é
escolhido por você:

- **Ollama (local)**: nenhum conteúdo sai do seu computador.
- **Gemini / provedor compatível com OpenAI**: o conteúdo da nota
  envolvido na operação é enviado ao provedor que você configurou. A chave de
  API fica no armazenamento seguro do sistema operacional e nunca é gravada
  dentro do Vault.
- O app registra um custo estimado das chamadas e respeita um orçamento mensal
  configurável, com parada antes do envio quando o teto seria estourado.

## 3. O que o app NÃO faz

- Não cria conta nem exige cadastro.
- Não envia telemetria, métricas de uso nem diagnósticos para servidores do
  projeto.
- Não lê, copia ou transmite suas notas sem uma ação explícita sua.
- Não armazena conteúdo de notas fora do seu computador.
- Não rastreia sua atividade fora do app.

## 4. Exclusão de dados

- Para apagar os dados do app, remova a pasta `.mirmind/` do Vault e, se
  desejar, a pasta de configuração do app.
- Desinstalar o aplicativo não remove seus Vaults nem suas notas.

## 5. Contato e atualizações

Esta política pode ser atualizada conforme o app evolui. A versão vigente
acompanha o release em `docs/privacy-policy.md`.
