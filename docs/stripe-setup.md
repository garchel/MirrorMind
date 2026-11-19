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

### O que está no ar (tudo verificado)

| peça | estado |
|---|---|
| migrations `0006`, `0007`, `0008` | aplicadas |
| endpoint do webhook no Stripe | `we_1UddWzHd1smsjlx77dJw3MuA`, **enabled**, 5 eventos |
| segredos das funções (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, os dois `price_…`) | gravados |
| função `stripe-checkout` | deployada (`verify_jwt: true`) |
| função `checkout-return` | deployada (`verify_jwt: false`) |
| função `stripe-webhook` | deployada (`verify_jwt: false`) |
| botões "Assinar R$ 30/mês" e "Assinar R$ 300/ano" | no app |

Medições feitas contra o Stripe e o Supabase reais:

- **checkout**: `POST /stripe-checkout` com sessão devolveu `https://checkout.stripe.com/…`
  para mensal **e** anual (sessões `cs_test_…` criadas de verdade);
- **webhook**: evento `checkout.session.completed` assinado com o `whsec_…` →
  `cloud_plan` virou `nuvem` no perfil; reentrega do mesmo evento → `duplicate`;
  evento mais antigo que um já aplicado → `stale` (e o acesso **não** voltou);
  assinatura errada → **400**;
- **vazamento**: `grep` no `dist/` depois do build → **0** ocorrências de
  `sk_test`/`whsec_`. O `.env` é ignorado pelo git e não é rastreado.

## Teste com cartão (opcional, o único passo que gasta dinheiro fictício)

Cartão de teste do Stripe: **4242 4242 4242 4242**, qualquer validade futura,
qualquer CVC.

1. Configurações → Nuvem → **Assinar R$ 30/mês**;
2. pagar no navegador;
3. voltar ao app e clicar em **Já paguei** (ou reabrir Configurações);
4. o bloco passa a dizer **Add-on ativo — válido até …**.

Se ficar em "Assinar", o evento não chegou: **Edge Functions → stripe-webhook →
Logs** no painel do Supabase. A causa mais comum é `whsec_…` de outro endpoint.

### Para limpar depois do teste

```sql
-- desfaz a assinatura de teste e os eventos sintéticos
delete from public.stripe_events where id like 'evt_%';
update public.profiles
   set cloud_plan = 'nenhum', plan_status = 'canceled',
       stripe_customer_id = null, stripe_subscription_id = null
 where email = 'seu-email@teste';
```

> `stripe_events.received_at` é quando a função aplicou; `stripe_created` é quando
> o Stripe gerou. A 0008 renomeia `processed_at` → `received_at` num banco que já
> tinha a tabela de uma versão anterior — sem ela, o `create if not exists` da 0006
> não faz nada e o repositório descreve uma coluna inexistente.

## Custo por assinatura (para conferir margem)

Stripe no Brasil, assinatura recorrente com cartão nacional: **3,99% + R$ 0,50**
por cobrança bem-sucedida (`stripe.com/en-br/billing/pricing`). Em R$ 30,00 isso
dá R$ 1,70 de taxa; a infraestrutura de nuvem de um assinante no teto de 10 GB
custa ~US$ 0,21 (≈ R$ 1,15). Margem bruta de **~R$ 27 por assinante**, antes de
impostos.

> A descrição do produto no Stripe deve dizer **10 GB**, para o cliente ver o que
> está comprando. Se o produto foi criado dizendo 2 GB, é só editar a descrição —
> o preço e o ID não mudam.
