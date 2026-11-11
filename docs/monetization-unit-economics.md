# Unit economics da monetização — modelo do beta

Planilha editável: [`monetization-unit-economics.xlsx`](monetization-unit-economics.xlsx).

Este documento explica as premissas do modelo. **Ele não é uma medição de custo
real**: o único custo com origem no código é a estimativa de preço por token; uso,
preço, nuvem, suporte e impostos são hipóteses até serem medidos.

## O que a planilha responde

- Quanto sobra por assinante nos cenários leve, médio e pesado.
- Em que ponto o custo de IA começa a apertar a margem.
- Qual preço mínimo entrega a margem alvo de 70%.
- Como o plano anual muda a receita e a margem.
- Onde o Pro com nuvem precisa ser precificado para não ficar abaixo da meta.

## Premissas iniciais (editáveis na aba Premissas)

| Premissa | Valor inicial | Status |
| --- | ---: | --- |
| Câmbio USD/BRL | R$ 5,50 | Hipótese |
| Essencial | R$ 69/mês | Hipótese |
| Pro | R$ 99/mês | Hipótese |
| Desconto anual | 20% | Hipótese |
| Taxa de pagamento | 4,5% + R$ 0,50 | Hipótese |
| Impostos | 6% | Hipótese |
| Suporte Essencial | R$ 3/assinante/mês | Hipótese |
| Suporte Pro | R$ 5/assinante/mês | Hipótese |
| Nuvem Pro | R$ 8/assinante/mês | Hipótese |
| Entrada Gemini | US$ 0,30/1M tokens | Estimativa do código |
| Saída Gemini | US$ 1,50/1M tokens | Estimativa do código |
| Tokens de entrada/chamada | 2.500 | Hipótese |
| Tokens de saída/chamada | 2.000 | Estimativa do código |
| Chamadas por sessão | 5 | Hipótese |
| Sessões/mês (leve/médio/pesado) | 8 / 25 / 60 | Hipótese |
| Chamadas avulsas/mês (leve/médio/pesado) | 5 / 15 / 40 | Hipótese |

## Resultado com as premissas iniciais

Custo estimado por chamada: **US$ 0,00375 ≈ R$ 0,0206**.
Custo por sessão de 5 chamadas: **≈ R$ 0,10**.

| Cenário | Chamadas/mês | Custo de IA/mês | Essencial R$ 69 — margem | Pro R$ 99 — margem |
| --- | ---: | ---: | ---: | ---: |
| Leve | 45 | R$ 0,93 | R$ 57,33 (83,1%) | R$ 74,18 (74,9%) |
| Médio | 140 | R$ 2,89 | R$ 55,37 (80,2%) | R$ 72,22 (72,9%) |
| Pesado | 340 | R$ 7,01 | R$ 51,24 (74,3%) | R$ 68,09 (68,8%) |

Leitura: **a IA não é o custo dominante** nesse modelo. Pagamento, impostos,
suporte e nuvem pesam mais. O Pro a R$ 99 fica ligeiramente abaixo da margem alvo
de 70% no cenário pesado; a partir de ~R$ 109 ele volta para cima da meta.

## Preço mínimo para 70% de margem

| Plano | Leve | Médio | Pesado |
| --- | ---: | ---: | ---: |
| Essencial | R$ 22,71 | R$ 32,76 | R$ 53,91 |
| Pro | R$ 73,99 | R$ 84,04 | R$ 105,19 |

Isso mostra por que o preço não deve ser definido pelo custo: no cenário leve, até
R$ 23 já entregaria 70% de margem. O preço é uma decisão de **valor percebido**,
não de custo unitário.

## Anual

Com 20% de desconto:

- Essencial: R$ 662,40/ano, equivalente a R$ 55,20/mês.
- Pro: R$ 950,40/ano, equivalente a R$ 79,20/mês.

O anual melhora o caixa, mas reduz a receita reconhecida. A planilha separa
receita anual, custos anuais, margem anual e equivalente mensal.

## O que ainda falta medir

O modelo é útil para discutir preço, mas não substitui telemetria. Antes de
prometer “quase ilimitado”, precisamos medir:

1. Chamadas reais por sessão (p50 e p95).
2. Tokens reais de entrada e saída por chamada.
3. Custo real por sessão na fatura do provedor.
4. Distribuição de sessões por usuário/mês.
5. Custo real de suporte por plano.
6. Custo real de nuvem por assinante, quando o backup existir.
7. Taxa de pagamento e regime tributário efetivos.

Sem esses números, a planilha continua sendo um **modelo de sensibilidade**, não
uma previsão de margem.
