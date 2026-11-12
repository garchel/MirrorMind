# Decisão de pacotes e fair use do beta

Data: 2026-11-11  
Status: **decisão de beta, preços ainda em teste**  
Base: [`monetization-unit-economics.xlsx`](monetization-unit-economics.xlsx) e
[`monetization-unit-economics.md`](monetization-unit-economics.md).

## Decisão em uma frase

Vender **conveniência e tranquilidade**, não acesso à IA: o grátis mantém o core,
Ollama e BYOK; o Essencial vende IA gerenciada com uso justo; o Pro vende IA +
nuvem. Nada de cota mensal visível para o usuário normal.

## Pacotes

| Item | Grátis | Essencial | Pro |
| --- | --- | --- | --- |
| Preço mensal | R$ 0 | **R$ 69** | **R$ 109** |
| Preço anual (20% off) | R$ 0 | **R$ 662,40** | **R$ 1.046,40** |
| Equivalente mensal no anual | R$ 0 | R$ 55,20 | R$ 87,20 |
| IA gerenciada | 50 chamadas únicas (~10 sessões) | Uso justo: 1.000 chamadas/mês | Uso justo: 1.200 chamadas/mês |
| Limite diário | 20 chamadas | 300 chamadas | 400 chamadas |
| Limite por minuto | 10 chamadas | 20 chamadas | 30 chamadas |
| Teto de custo de IA | — | US$ 4/mês | US$ 5/mês |
| Nuvem | Não | Não | **Sim** |
| Ollama local | Sim | Sim | Sim |
| BYOK | Modo avançado, sem suporte | Modo avançado, sem suporte | Modo avançado, sem suporte |
| Suporte | Comunidade | Padrão | Prioritário |

## Por que esses preços

- **Essencial R$ 69:** a margem fica entre 74,3% e 83,1% nos cenários leve,
  médio e pesado. No teto de fair use (1.000 chamadas), ainda entrega ~54,5%.
  R$ 69 deixa espaço para uma promoção de fundador e para o anual de R$ 55,20/mês.
- **Pro R$ 109:** a R$ 99 a margem no cenário pesado ficaria em ~68,8%, abaixo da
  meta de 70%. A R$ 109 ela sobe para ~70,7%; no teto de fair use (1.200
  chamadas), fica em ~54,4%. O Pro só se justifica se a nuvem entregar algo além
  de armazenamento bruto.
- **A IA não é o custo dominante.** No modelo, pagamento, impostos, suporte e
  nuvem pesam mais que a inferência. O preço é uma decisão de valor percebido.

## Fair use: “quase ilimitado” sem mentir

O produto **não** deve anunciar “ilimitado”. A promessa é:

> “Uso justo: no dia a dia você não vê cota. Os limites existem para impedir
> abuso e manter o serviço saudável.”

Regras:

1. Não mostrar cota mensal no app para o usuário normal.
2. Mostrar apenas o consumo quando o usuário se aproximar do teto.
3. Ao atingir o teto, a IA gerenciada para com mensagem clara e oferece:
   - usar Ollama/BYOK; ou
   - aguardar o próximo ciclo.
4. Nunca cobrar excesso sem o usuário escolher.
5. O teto de custo será **por conta**, não por Vault, quando o ledger do servidor
   entrar (F3/F4). O contador local por Vault é só proteção do protótipo.

Os limites de 1.000/1.200 chamadas/mês são altos o suficiente para o usuário
normal nunca encostar: o cenário pesado do modelo usa 340 chamadas/mês.

## BYOK e Ollama

**Decisão:** manter os dois no beta.

- **Ollama local:** grátis, sempre. Custo zero para o produto e prova viva da
  promessa local-first.
- **BYOK:** existe, mas em **Configurações avançadas de IA**, com aviso de que é
  para quem já tem chave e entende o custo. Sem suporte dedicado.

Por que não remover:

- O cliente que paga R$ 69–109 quer conveniência, não configurar chave.
- A chave não substitui o produto: fila, agendamento, sessões, relatório e
  verificação factual continuam sendo o valor.
- Os usuários técnicos são os que mais divulgam o app; removê-los no beta custa
  mais em distribuição do que economiza em canibalização.
- BYOK é a válvula de escape do fair use: quem bate no teto ainda tem caminho.

Se o beta mostrar canibalização real, a resposta é medir e ajustar a
conveniência — não retirar uma promessa já feita.

## Grátis e trial

- 50 chamadas gerenciadas **uma vez**, não renováveis. Dá para sentir o valor
  (~10 sessões) sem sustentar uso permanente.
- Sem trial pago separado no beta: a amostra grátis é o trial. Um trial de 7 dias
  pode entrar depois, quando checkout e antifraude existirem.
- Ollama/BYOK continuam livres; o grátis nunca fica sem IA.

## Gatilhos de upgrade

O app deve oferecer o plano no momento de valor, sem nag:

1. Quando as 50 chamadas grátis acabam.
2. Quando o usuário tenta iniciar uma revisão gerenciada sem cota.
3. Quando o usuário atinge o teto de fair use.
4. Quando o usuário tenta usar nuvem no Essencial.
5. Na tela de plano, com uso e benefícios claros.

Não interromper uma sessão em andamento para vender. Não esconder o botão de
continuar com Ollama/BYOK.

## Condições de guarda

- Se o custo real de nuvem passar de **R$ 10/mês por assinante**, o Pro precisa ir
  para **R$ 119+** ou reduzir escopo.
- Se o custo real de IA por sessão ficar **2× acima** do modelo, revisar preço
  e/ou tetos antes de escalar.
- Se o p95 de uso passar de **200 sessões/mês**, reavaliar o fair use.
- Se o churn do Essencial for alto por preço, testar R$ 59 como promoção de
  fundador — não como preço permanente.
- Não vender plano vitalício com IA gerenciada.

## O que precisa ser instrumentado antes de escalar

Primeira medição feita em 2026-11-12: Ollama local medido; DeepSeek direto
bloqueado por 402; ver [`ai-benchmark-report.md`](ai-benchmark-report.md).
Ainda faltam p50/p95, tokens reais com schema e custo de nuvem.

Eventos:

- `managed_ai_call` (provider, tokens, custo estimado, plano);
- `review_session_started` / `review_session_completed`;
- `fair_use_cap_hit`;
- `upgrade_viewed` / `upgrade_clicked`;
- `checkout_started` / `subscription_started` / `subscription_canceled`;
- `byok_enabled` / `ollama_used`.

Métricas:

- chamadas por sessão (p50/p95);
- custo real por sessão;
- sessões por usuário/mês;
- grátis → pago;
- hit rate do fair use;
- margem por plano;
- churn e motivo do cancelamento.

## O que ainda não está decidido

- Preço final depois do beta.
- Tamanho e escopo da nuvem do Pro.
- Trilho de Pix (Stripe ou alternativo).
- Política de reembolso/trial pago.
- Se o Essencial terá limite anual diferente do mensal.

## Próximos passos de implementação

1. Migrar o catálogo de planos de `ia_mensal`/`ia_anual` para `essencial`/`pro`
   (F3), preservando compatibilidade com direitos antigos.
2. Colocar os tetos de fair use no entitlement por plano, não em constantes
   globais.
3. Levar o ledger de uso para o servidor, por conta.
4. Implementar checkout + portal + webhook idempotente.
5. Instrumentar os eventos e revisar a planilha com dados reais após 30 dias.
6. Só então decidir o preço final.
