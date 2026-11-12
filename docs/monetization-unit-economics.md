# Unit economics da monetização — modelo do beta

Planilha editável: [`monetization-unit-economics.xlsx`](monetization-unit-economics.xlsx).

Decisão de pacotes e fair use: [`monetization-beta-decision.md`](monetization-beta-decision.md).

Este documento explica as premissas do modelo. **Ele não é uma medição de custo
real**: o único custo com origem no código é a estimativa de preço por token; uso,
preço, nuvem, suporte e impostos são hipóteses até serem medidos.

## Decisão do beta (2026-11-11)

| Pacote | Preço mensal | Preço anual (20% off) | Fair use |
| --- | ---: | ---: | --- |
| Grátis | R$ 0 | R$ 0 | 50 chamadas gerenciadas, uma vez |
| Essencial | R$ 69 | R$ 662,40 | 1.000 chamadas/mês; 300/dia; 20/min; teto US$ 4/mês |
| Pro | R$ 109 | R$ 1.046,40 | 1.200 chamadas/mês; 400/dia; 30/min; teto US$ 5/mês |

O Pro inclui nuvem; o Essencial não. **Não existe cota mensal visível**: os
números acima são proteção antiabuso. Ao atingir o teto, o app oferece BYOK/Ollama
ou o próximo ciclo, sem cobrança surpresa.

Preços são **hipótese de teste do beta**, não decisão final. A margem alvo de 70%
vale para o uso esperado; no teto de fair use, a margem cai para ~54%, ainda
positiva.

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
| Essencial | R$ 69/mês | Decisão beta |
| Pro | R$ 109/mês | Decisão beta |
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

| Cenário | Chamadas/mês | Custo de IA/mês | Essencial R$ 69 — margem | Pro R$ 109 — margem |
| --- | ---: | ---: | ---: | ---: |
| Leve | 45 | R$ 0,93 | R$ 57,33 (83,1%) | R$ 83,13 (76,3%) |
| Médio | 140 | R$ 2,89 | R$ 55,37 (80,2%) | R$ 81,17 (74,5%) |
| Pesado | 340 | R$ 7,01 | R$ 51,24 (74,3%) | R$ 77,04 (70,7%) |

Leitura: **a IA não é o custo dominante** nesse modelo. Pagamento, impostos,
suporte e nuvem pesam mais. O Pro a R$ 109 passa da margem alvo de 70% no cenário
pesado; a R$ 99 ficaria em ~68,8% nesse mesmo cenário.

## Margem no teto de fair use

| Plano | Chamadas/mês | Custo de IA/mês | Margem |
| --- | ---: | ---: | ---: |
| Essencial | 1.000 | R$ 20,63 | R$ 37,63 (54,5%) |
| Pro | 1.200 | R$ 24,75 | R$ 59,31 (54,4%) |

O teto de fair use é uma proteção contra abuso, não uma cota comercial. A margem
de ~54% no teto é o piso aceitável; se o custo real ficar 2× acima do modelo,
preço e/ou tetos precisam ser revistos.

## Benchmark real (2026-11-12)

Primeira medição com os prompts reais do código:

- **Ollama qwen2.5:7b (local):** medido. Tokens e latência reais; custo de API zero.
- **DeepSeek V4.1 Flash direto:** não medido — o endpoint respondeu **402** (sem plano/saldo para a chave). O custo abaixo é um **proxy** que aplica o preço de tabela do DeepSeek aos tokens medidos no Ollama.
- **OpenCode Go (DeepSeek via agente):** uma execução mínima consumiu ~5.900 tokens de entrada por causa do system prompt/ferramentas do agente; não representa o custo do app.

Custo proxy do DeepSeek por fluxo:

| Fluxo | Chamadas | Custo proxy |
| --- | ---: | ---: |
| Prova (primeira sessão) | 2 | R$ 0,0033 |
| Prova (sessão seguinte) | 1 | R$ 0,0021 |
| Conversa (4 turnos) | 6 | R$ 0,0054 |
| Conversa (6 turnos) | 8 | R$ 0,0061 |
| Verificação factual | 2 | R$ 0,0135 |

As chamadas medidas ficaram abaixo das 2.500/2.000 tokens por chamada assumidas na planilha, exceto a verificação factual, que bateu no teto de 2.000 tokens de saída. O schema JSON do app **não** entrou no benchmark, então os tokens reais serão maiores; trate esses valores como piso.

Detalhes: [`ai-benchmark-report.md`](ai-benchmark-report.md) e aba **Benchmark real** da planilha.

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
- Pro: R$ 1.046,40/ano, equivalente a R$ 87,20/mês.

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
