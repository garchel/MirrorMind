# Stripe: produtos e preços do MirrorMind

Identificadores são públicos (aparecem no checkout) e por isso podem morar no
repositório. Chaves de API **não** entram aqui — só no `.env` e no servidor.

## Produtos criados

| Produto | Ambiente | ID do produto |
| --- | --- | --- |
| MirrorMind Nuvem | teste | `prod_VetjgMiBADHRZT` |

## Preços

| Preço | Valor | Recorrência | ID |
| --- | --- | --- | --- |
| Nuvem mensal | R$ 30,00 | mensal | `price_1UdZvfHd1smsjlx7lCoo8QKT` |
| Nuvem anual | R$ 300,00 | anual | `price_1UdZxHHd1smsjlx7cfOaz7vd` |

No app, os IDs entram no build por variável de ambiente:

```
VITE_STRIPE_PRICE_CLOUD_MONTH=price_1UdZvfHd1smsjlx7lCoo8QKT
VITE_STRIPE_PRICE_CLOUD_YEAR=price_1UdZxHHd1smsjlx7cfOaz7vd
```

> Os IDs acima são do **modo de teste**. No dia do lançamento é preciso repetir a
> criação no modo de produção (mesmos nomes e valores) e trocar os IDs do build.

## Como o checkout funciona

```
app (Rust)  →  Edge Function stripe-checkout  →  Stripe Checkout (navegador)
                                   ↑
Stripe  →  Edge Function stripe-webhook  →  profiles.cloud_plan = 'nuvem'
```

Três decisões que não são detalhe:

1. **A chave secreta nunca vai para o app.** Um binário distribuído é um arquivo
   que qualquer um abre; preço e cobrança ficam no servidor. O app só diz "mensal"
   ou "anual".
2. **Quem ativa é o webhook, não o retorno do navegador.** A página de retorno só
   diz "pode fechar esta aba". Voltar do Stripe não prova pagamento; o evento
   assinado prova.
3. **`cloud_plan` é escrito apenas pelo webhook**, com a service role. A policy de
   leitura do próprio perfil é a única coisa que o app precisa.

### O que já está no ar

| peça | estado |
|---|---|
| migration `0006`/`0007` (ids do Stripe, `stripe_events`, `my_entitlements`) | aplicada |
| função `stripe-checkout` | deployada (`verify_jwt: true`) |
| função `checkout-return` | deployada (`verify_jwt: false`) |
| função `stripe-webhook` | **falta subir** (ver abaixo) |
| botões "Assinar R$ 30/mês" e "Assinar R$ 300/ano" | no app |

Medido hoje: sem sessão a função responde **401**; com sessão e sem a chave do
Stripe, **501** com a frase "O checkout ainda não está configurado neste
ambiente." — e é isso que o app mostra, em vez de fingir que tentou.

## O que falta fazer (5 minutos, uma vez)

Precisa de duas chaves do painel do Stripe (modo de teste): a **secret key**
(`sk_test_…`) e o **signing secret** do webhook (`whsec_…`, criado no passo 2).

```bash
# 1. login no Supabase (abre o navegador)
npx supabase login

# 2. criar o webhook no painel do Stripe
#    Developers → Webhooks → Add endpoint
#    URL: https://uzxpeoxrvdcptvbepzua.supabase.co/functions/v1/stripe-webhook
#    Eventos:
#      checkout.session.completed
#      customer.subscription.created
#      customer.subscription.updated
#      customer.subscription.deleted
#      invoice.payment_failed
#    Copie o "Signing secret" (whsec_…) que o painel mostra.

# 3. gravar os segredos nas funções
npx supabase secrets set --project-ref uzxpeoxrvdcptvbepzua \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_CLOUD_MONTH=price_1UdZvfHd1smsjlx7lCoo8QKT \
  STRIPE_PRICE_CLOUD_YEAR=price_1UdZxHHd1smsjlx7cfOaz7vd

# 4. subir o webhook (as outras duas já estão no ar)
npx supabase functions deploy stripe-webhook \
  --project-ref uzxpeoxrvdcptvbepzua --no-verify-jwt
```

Depois disso, testar com o cartão de teste do Stripe **4242 4242 4242 4242**
(qualquer validade futura, qualquer CVC):

1. Configurações → Nuvem → **Assinar R$ 30/mês**;
2. pagar no navegador;
3. voltar ao app e clicar em **Já paguei** (ou reabrir Configurações);
4. o bloco passa a dizer **Add-on ativo — válido até …**.

Se ficar em "Assinar", o evento não chegou: veja **Edge Functions → stripe-webhook
→ Logs** no painel do Supabase. A causa mais comum é o `whsec_…` de outro
endpoint (o segredo é por endpoint, não da conta).

## Custo por assinatura (para conferir margem)

Stripe no Brasil, assinatura recorrente com cartão nacional: **3,99% + R$ 0,50**
por cobrança bem-sucedida (`stripe.com/en-br/billing/pricing`). Em R$ 30,00 isso
dá R$ 1,70 de taxa; a infraestrutura de nuvem de um assinante no teto de 10 GB
custa ~US$ 0,21 (≈ R$ 1,15). Margem bruta de **~R$ 27 por assinante**, antes de
impostos.

> A descrição do produto no Stripe deve dizer **10 GB**, para o cliente ver o que
> está comprando. Se o produto foi criado dizendo 2 GB, é só editar a descrição —
> o preço e o ID não mudam.
