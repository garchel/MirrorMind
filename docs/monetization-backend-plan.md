# Backend de contas — desenho e execução (F1b)

> Complementa [`monetization-foundation.md`](monetization-foundation.md). Este
> documento responde a uma pergunta só: **o que existe no servidor e por quê**.

## Decisão confirmada

| Peça | Escolha | Por quê |
| --- | --- | --- |
| Contas, banco, funções | **Supabase** (`Postgres` + `Auth` + `RLS` + `Edge Functions`) em **`sa-east-1` (São Paulo)** | região BR existe (`sa-east-1`); RLS resolve autorização sem backend próprio; Edge Function dá o único ponto onde a cota pode ser decidida de verdade |
| Cobrança | **Stripe** (cartão + **Pix**) | o risco nº 1 da F0 caiu: a Stripe passou a suportar **Pix Automático** (recorrente) — changelog `2026-04-22`. Pix único e recorrente, com liquidação em BRL |
| Identidade no app desktop | **Authorization Code + PKCE com loopback** (`http://127.0.0.1:<porta>/callback`), deep link `mirrormind://auth` como alternativa | RFC 8252: é o fluxo recomendado para app nativo. Deep link no Windows pode ser registrado por outro app — não serve como canal primário |
| Guarda de token | **OS keyring**, refresh apenas no Rust | já implementado (`account_save_session` / `account_load_session` / `account_clear_session`) |

## O que o servidor guarda — e o que ele nunca guarda

Princípio que já está na política de privacidade: **servidor cego**. A conta
guarda *quem paga e quanto usou*; o conteúdo das notas fica no computador do
usuário.

Isso divide o backend em duas metades que **não** devem nascer juntas:

1. **Conta e cobrança** (F1b–F4) — e-mail, plano, status, consumo. PII mínima.
2. **Nuvem do Pro** (depois) — se as notas forem para o servidor, só podem ir
   **cifradas no cliente** (E2EE). Servidor guarda blob cifrado + metadados
   mínimos. Retrofitar criptografia depois é caro e desmente o que já foi
   prometido; por isso o sync nasce com chave do cliente, não com "a gente vê
   depois".

## Modelo de dados (F1b)

```sql
profiles(id → auth.users, email, plan, plan_status, plan_period_end, ...)
subscriptions(id, user_id, stripe_customer_id, stripe_subscription_id, status, ...)
ai_usage(id, user_id, occurred_at, provider, tokens, cost_usd, idempotency_key, ...)
stripe_events(id text pk, type, processed_at)   -- idempotência do webhook
devices(id, user_id, label, last_seen_at)       -- opcional, "sair de todos"
```

Regras que não são negociáveis no schema:

- **`plan` em `profiles`, não em JWT emitido pelo app.** O JWT carrega
  `app_metadata.plan` para o cliente saber o que mostrar, mas **quem decide** é
  a função do servidor, lendo `profiles` a cada chamada.
- **`ai_usage.idempotency_key` é `unique`.** Retry de rede não pode virar duas
  cobranças nem duas chamadas contadas.
- **`stripe_events` com o `event.id` como PK.** Webhook duplicado é o
  comportamento normal da Stripe, não exceção.
- **Ninguém escreve `ai_usage` pelo cliente.** `insert` só com `service_role`
  (Edge Function); o usuário lê o próprio consumo, não escreve.
- **RLS em tudo**, com `select` restrito a `auth.uid() = user_id` e `update` em
  `profiles` limitado a colunas não comerciais (nome de exibição). Plano e datas
  são escritos apenas pelo webhook.

Arquivo pronto para aplicar: [`supabase/migrations/0001_accounts.sql`](../supabase/migrations/0001_accounts.sql).

## Onde a cota é decidida

O gate do cliente (`managedAiGate`) é **UX**: ele evita oferecer um botão que
vai falhar. A decisão real acontece na Edge Function `ai-managed`:

```
JWT válido → lê profiles.plan → conta ai_usage do dia/mês
  → abaixo do teto  → grava reserva idempotente → chama o provedor → grava custo
  → no teto         → 429 com motivo e data de renovação
```

Sem isso, cota é decoração: qualquer cliente modificado chama o provedor direto.

## Fases desta frente

| Fase | Entrega | Aceite |
| --- | --- | --- |
| **F1b-1** | projeto Supabase `sa-east-1`, migration aplicada, RLS revisada | criar usuário de teste pelo painel e ver `profiles` nascer por trigger |
| **F1b-2** | `SupabaseSessionClient` (PKCE loopback + deep link), sessão no keyring | criar conta → fechar → reabrir logado; sair; token nunca no `localStorage` |
| **F1b-3** | tela Conta ligada (login, cadastro, Google, sair, excluir) | excluir conta remove perfil e sessão local sem resto |
| **F2b** | `useEntitlement` alimentado pelo servidor + cache 30 dias | revogar plano no painel rebaixa em ≤ 30 dias offline e na hora online |
| **F3** | checkout Stripe (cartão + Pix Automático), webhook, portal | assinar ativa em <60s; cancelar rebaixa sem perder dado; webhook duplicado idempotente |
| **F4** | `ai-managed` + ledger + UI de uso | chamadas do plano batem centavo a centavo; retry não duplica |

## Custos

| Item | Hoje | Com tração |
| --- | --- | --- |
| Supabase Free | R$ 0 (500 MB, 50k MAU) | — |
| Supabase Pro | — | US$ 25/mês (8 GB, backup diário 7 dias) |
| Stripe | por transação | 3,99% + R$ 0,39 (cartão); Pix ~0,99% |
| Domínio/e-mail transacional | ~R$ 5/mês | Resend/SES |

O Free cobre o beta inteiro. O Pro entra quando houver pagante — não antes.

## Riscos e como cada um é contido

| Risco | Contenção |
| --- | --- |
| Deep link sequestrado no Windows | loopback é o canal primário; deep link é conveniência |
| Cliente modificado burla cota | cota só na função do servidor; provedor sem chave no cliente |
| Webhook duplicado/fora de ordem | `stripe_events` por `event.id` + reconsulta do objeto na Stripe |
| Perder assinatura sem internet | cache de 30 dias (fail-open para o pago) já implementado |
| Notas vazando para o servidor | nuvem só com E2EE; sem tabela de conteúdo no backend de contas |
| LGPD: dado em região errada | `sa-east-1` desde o dia 1 |

## Perguntas abertas

1. **Google login** entra na F1b-2 ou só e-mail+senha no beta? (OAuth do Google
   exige tela de consentimento e domínio verificado — atrito de 1–2 dias.)
2. **Projeto Supabase**: criar já em `sa-east-1` no plano Free (migrar de região
   depois exige recriar o projeto).
3. **Pix Automático na Stripe**: validar no sandbox se ele funciona dentro de
   `subscriptions` (e não só em invoice avulsa) antes de prometer Pix recorrente
   no site.
