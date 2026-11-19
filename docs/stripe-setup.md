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

## Custo por assinatura (para conferir margem)

Stripe no Brasil, assinatura recorrente com cartão nacional: **3,99% + R$ 0,50**
por cobrança bem-sucedida (`stripe.com/en-br/billing/pricing`). Em R$ 30,00 isso
dá R$ 1,70 de taxa; a infraestrutura de nuvem de um assinante de 2 GB custa
~R$ 0,23/mês. Margem bruta de ~R$ 28 por assinante, antes de impostos.
