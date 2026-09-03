# Política de privacidade — MirrorMind

> Versão 1.0 — 2026-09-01. Esta política descreve o comportamento REAL do app
> (fonte: `docs/release-validation-procedures.md` e código em `src-tauri/src`).
> Para dúvidas sobre LGPD, contate o Encarregado abaixo.

## Resumo

O MirrorMind é um aplicativo de **notas local-first**: seus arquivos Markdown e seus dados ficam no seu computador, dentro do Vault que você escolhe. O app não cria conta, não coleta telemetria e não transmite conteúdo de notas por padrão. Recursos de IA são opcionais e exigem consentimento explícito antes de qualquer envio.

**Controlador:** MirrorMind (projeto garchel/MirrorMind — enquanto pessoa jurídica não constituída, o mantenedor atua como controlador para fins de LGPD).  
**Encarregado (DPO) — Art.41 LGPD:** `privacidade@mirrormind.local` (placeholder até nomeação formal; enquanto isso use [GitHub Issues](https://github.com/garchel/MirrorMind/issues) com label `privacidade`).  
**Base legal principal:** consentimento (Art.7, I) para IA remota; legítimo interesse (Art.7, IX) para verificação de atualizações; execução de funcionalidades locais para o restante.

## 1. O que o app armazena e onde — e por quanto tempo (Art.16)

| Onde | O que | Retenção |
| --- | --- | --- |
| Dentro do Vault (`.mirmind/`) | `config.json` (favoritos, preferências), `history.json` (até 100 comandos undo/redo), `trash.json` + `trash/` (lixeira), `review-usage.json` (contadores diário/mensal de IA), `learning/` (estado de revisão FSRS por nota), índice de wikilinks | Histórico limitado a 100 entradas (`HISTORY_LIMIT`); lixeira expira em 30 dias (`TRASH_RETENTION_DAYS`); `review-usage.json` reseta por dia/mês; `learning/` persiste até você reiniciar a nota ou descartar documento irrecuperável. Tudo é destruído junto com o Vault — nunca pelo instalador. |
| Pasta de configuração do app (`%APPDATA%\com.mirrormind.desktop`) | `recent-vault.json` (último Vault + `ask_before_reopen`) e preferências de notificação | Persiste até você usar **Configurações > Aplicativo > Apagar meus dados locais** ou apagar o arquivo manualmente. A desinstalação NÃO remove esta pasta por padrão. |
| Pasta de dados locais do app (perfil WebView2) | `localStorage` (`mirrormind.*` — tema, fonte, atalhos, layout do grafo, provedor de IA escolhido) | Até limpar via **Apagar meus dados locais** ou limpar dados do WebView2. Recriado na primeira abertura. |
| Cofre do sistema operacional (OS keyring) | Chave Gemini, `base_url/model/api_key` do provedor OpenAI-compatible e flags de consentimento (`gemini-content-consent-v1`, `openai-compatible-consent-v1`) | Até você remover em **Configurações > Revisão com IA** ou via **Apagar meus dados locais** (remove do keyring). Nunca gravado dentro do Vault. |

Os seus arquivos `.md` e anexos **nunca** são movidos ou copiados para fora do Vault pelo app. A desinstalação remove o programa e não apaga Vaults, notas ou conteúdo do usuário.

## 2. IA (opcional, sob seu controle) — Consentimento Art.8 e Transferência Internacional Art.33

Recursos de IA (avaliação de prontidão, revisão, verificação de fatos, visão) são **opcionais** e só rodam quando você aciona cada operação. O provedor é escolhido por você:

- **Ollama (local)**: nenhum conteúdo sai do seu computador. Sem transferência internacional. Ideal para notas com dados pessoais ou sensíveis (Art.11).
- **Gemini (Google)**: o Markdown da nota selecionada e os dados da sessão são enviados a `generativelanguage.googleapis.com` (EUA) — transferência internacional (Art.33). A chave fica no cofre do SO. **Exige consentimento nativo do SO** (`Autorizar envio ao Gemini`) antes de qualquer envio; você pode revogar a qualquer momento desmarcando a opção. O consentimento é registrado no cofre com a marca `accepted`.
- **Provedor compatível com OpenAI** (OpenAI, OpenRouter, LM Studio, vLLM...): o conteúdo da mesma forma é enviado ao `base_url` que você configurou. **Exige consentimento nativo do SO** (`Autorizar envio ao servidor`) antes de qualquer envio; revogável. Para servidores remotos, **só `https` é permitido** (`http` apenas para `127.0.0.1/localhost` — proteção Art.46); o painel alerta sobre transferência internacional.

Em todos os casos remotos:
- O app envia **somente** o Markdown da nota selecionada + dados da sessão (ou bytes da imagem para visão) — nunca o vault inteiro.
- A chave de API fica no armazenamento seguro do SO e nunca é gravada dentro do Vault.
- O app registra custo estimado e respeita orçamento mensal com **parada dura ANTES do envio** quando o teto seria estourado (`review-usage.json`).

> **Dados sensíveis e crianças (Art.11, Art.14):** não envie notas com dados sensíveis, de saúde, biométricos ou de crianças/adolescentes para provedores remotos sem necessidade e base legal adequada. Prefira Ollama local nesses casos. O app não verifica idade.

## 3. Atualizações do app (updater) — Art.7, IX e Art.9

Ao abrir, **se a opção estiver ativa** (padrão: ativa), o app verifica se há versão nova consultando o manifesto `latest.json` no GitHub Releases (`github.com/garchel/MirrorMind`). Essa verificação:

- é a **única** conexão de rede automática do app e pode ser **desativada** em **Configurações > Aplicativo > Verificação automática de atualizações** (LGPD Art.9 — transparência; seu IP será enviado ao GitHub se a verificação estiver ativa);
- envia apenas a requisição HTTP padrão (sem identificadores, sem dados de uso, sem conteúdo de notas);
- é assinada criptograficamente: o app só instala pacotes cuja assinatura minisign corresponde à chave pública embarcada no binário;
- pode ser disparada manualmente em **Configurações > Aplicativo > Verificar atualizações**. A instalação pede confirmação — nada é instalado sem seu clique em "Baixar e instalar".

## 4. Crash reporting

O MirrorMind **não possui relatório automático de falhas** (crash reporting). Nenhum diagnóstico é coletado ou transmitido sem consentimento explícito. Para reportar um problema, use os [templates de issue](https://github.com/garchel/MirrorMind/issues) ou as [Discussions](https://github.com/garchel/MirrorMind/discussions).

## 5. O que o app NÃO faz

- Não cria conta nem exige cadastro.
- Não envia telemetria, métricas de uso nem diagnósticos para servidores do projeto.
- Não lê, copia ou transmite suas notas sem ação explícita sua.
- Não armazena conteúdo de notas fora do seu computador.
- Não rastreia sua atividade fora do app.

## 6. Seus direitos (Art.18 LGPD) — como exercer

Você pode, a qualquer momento, via interface ou arquivos locais:

| Direito | Como exercer |
| --- | --- |
| Confirmação, acesso, correção | Abra o Vault — suas notas são `.md` editáveis; `Configurações` mostra preferências. |
| Eliminação / anonimização | Apague a nota/arquivo, esvazie a lixeira, ou use **Configurações > Aplicativo > Apagar meus dados locais** (remove `recent-vault.json`, `localStorage` e chaves do cofre). Para o Vault, remova `.mirmind/`. |
| Portabilidade | Copie os `.md` e anexos — formato aberto. |
| Revogação do consentimento | Desmarque **Autorizo o envio** em **Revisão com IA** (Gemini ou OpenAI-compatible) — o flag é removido do cofre e novos envios são bloqueados. |
| Informação sobre compartilhamento | Esta política (seção 2 e 3). |
| Oposição / revisão de decisões automatizadas | A revisão com IA é assistiva e não toma decisões vinculantes; você pode usar só Ollama local. |

Para solicitações ao Encarregado: `privacidade@mirrormind.local` ou GitHub Issues com label `privacidade`. Resposta em até 15 dias (Art.19).

## 7. Segurança (Art.46) e retenção (Art.16)

- Chaves no cofre do SO, `zeroize` em memória, validação de caminhos contra `symlink`/`path traversal`, limites de tamanho (nota 2 MiB, imagem visão 4 MiB), `no_proxy` + sem seguir redirects com payload, backups transacionais de `learning/` e escrita atômica.
- Retenção conforme tabela da seção 1; lixeira 30 dias, histórico 100.

## 8. Contato e atualizações desta política

Esta política pode ser atualizada conforme o app evolui. A versão vigente acompanha o release em `docs/privacy-policy.md` e o histórico fica no Git.
