# Fundação de Monetização — Planejamento e Acompanhamento

> Escola grátis, cantina e guarda-volumes pagos, caixa registradora primeiro.
> Decisões travadas: **Stripe** (cobrança; Pix a verificar na F0) · **Supabase Auth** (contas) · **São Paulo** (região dos dados).

## Princípios inegociáveis

1. Core, privacidade e exportação nunca atrás de paywall — nem offline nem online.
2. Local-first sobrevive: sem internet, tudo que é local funciona; só IA gerenciada e nuvem pedem rede.
3. Servidor cego por design: a conta guarda *quem paga e quanto usou*, nunca o conteúdo das notas.
4. Fail-open para o pago, fail-closed para o gasto: sem internet o plano pago continua valendo (cota assinada em cache de 30 dias); sem cota, a IA gerenciada nega com mensagem clara.

## Arquitetura (4 peças)

### 1. Identidade
Signup/login com e-mail+senha e Google; sessão via PKCE com callback `mirrormind://auth` (`tauri-plugin-deep-link` + esquema registrado); tokens **no OS keyring** (nunca localStorage); "excluir minha conta" em 2 cliques (LGPD Art. 18, com cascata no servidor). Hook `useSession()`: `{ status: 'anon' | 'auth', email, expiresAt }`.

### 2. Direitos (entitlements)
Servidor emite JWT com `{plano, cotas, expiração}` (`app_metadata.plan`); app guarda cache de **30 dias offline** e trata expirado como grátis (fail-open + aviso). Checagem só em 2 pontos: `provider_for_selection('managed')` e comandos de backup. Core não sabe que plano existe.

### 3. Cobrança
Produtos Stripe (`ia_mensal`, `ia_anual` −20%, BRL, Billing Meter `ai_calls`); checkout hospedado; Edge Function `stripe-webhook` idempotente (`event.id`) atualizando `subscriptions` + `profiles.plan`; **portal do Stripe** para upgrade/downgrade/cancelar/2ª via; inadimplência com 7 dias de graça e rebaixamento (nunca apaga local). Trilho Pix a confirmar na F0 (fallback: AbacatePay/Efi).

### 4. Medição (caixa)
Estender `reserve_ai_call` para ledger persistente (`usage_ledger` com `idempotency_key`): reserva local → executa → confirma uso; falha de rede reconcilia depois, nunca bloqueia. UI "Meu uso" com barra, aviso aos 80% e data de renovação. Ollama/BYOK ilimitados e fora do ledger.

## LGPD embutida
Pagamento nunca toca nossos servidores (Stripe/MoR). Região BR. Log de consentimentos. Exportação (JSON) e exclusão em cascata (Auth + perfil + ledger + keyring local) desde o dia 1. DPA com cada subprocessador. NFS-e via emissor + contador (Stripe não é merchant of record).

## Fases e aceite

| Fase | Escopo | Aceite |
|------|--------|--------|
| **F0** | Pix no Stripe (ou 2º trilho), região SP no Supabase, emissor NF + contador | 3 linhas acima verdes por escrito; nada abaixo começa com F0 vermelha |
| **F1** | Auth fim-a-fim: PKCE + deep-link, sessão no keyring, tela Conta, excluir conta (local) | criar conta → reabrir logado → sair/entrar; token fora de plaintext; testes com backend mockado |
| **F2** | Catálogo (`gratis`, `ia_mensal`), `useEntitlement()`, graça 30 dias, flags nos 2 pontos (sem cobrar) | plano manual libera/nega com copy; expiração simulada; core sem flags |
| **F3** | Checkout + webhooks + portal, sandbox primeiro | assinar via Pix/cartão ativa em <60s; cancelar rebaixa sem perder dados; webhook duplicado idempotente |
| **F4** | Ledger + UI de cota + alertas de custo/abuso | 200 chamadas batem centavo a centavo; retry não duplica; esgotado nega com data |
| **F5** | Exportação, cascata, DPA, caos controlado, runbook + flag `billing_enabled=false` | conta excluída sem restos (teste prova); rollback sem deploy |

Estimativa: **7–10 semanas**, 1 dev focado. Risco nº 1: Pix recorrente (se F0 devolver 2º trilho, F3 += 1 semana).

## Status de implementação

- [x] F1a (sem backend): esquema deep-link `mirrormind://`, cofre de sessão no keyring, catálogo/flag `billing_enabled=false`, tipos de direitos
- [ ] F0 (humano): verificações de mercado acima
- [ ] F1b (com Supabase): PKCE real, tela Conta, refresh, excluir conta
- [ ] F2–F5: conforme tabela
