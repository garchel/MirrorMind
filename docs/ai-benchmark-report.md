# Benchmark de custo de IA — medição real

Gerado em 2026-11-12T16:25:43.736Z.

Este relatório usa os prompts reais extraídos do código do MirrorMind. O conteúdo das notas é real (pequena) ou sintético (média). Tokens e latência do Ollama vêm da API local. O DeepSeek direto não pôde ser medido porque o endpoint respondeu 402; o custo dele abaixo é um **proxy** que aplica o preço de tabela aos tokens medidos no Ollama.

## Status dos provedores

- **Ollama qwen2.5:7b:** medido localmente; tokens de entrada/saída e latência são reais.
- **DeepSeek V4.1 Flash direto:** **não medido**. O endpoint retornou 402 (sem plano ativo/saldo para a chave). O custo é proxy.
  - Erro: HTTP 402: {"error":{"message":"No active plan was found on this account (API key thk_live_...) and the wallet balance can't cover this model; if you hold a Pass, make sure your app uses a key from the account that holds it (https://toke
- **OpenCode Go (DeepSeek via agente):** uma execução mínima consumiu ~5.900 tokens de entrada e 6 de saída; esse número inclui o system prompt e as ferramentas do agente, então **não representa** o custo do app.

## Notas usadas

| Nota | Palavras | Caracteres |
| --- | ---: | ---: |
| small | 62 | 481 |
| medium | 335 | 2212 |

## Chamadas medidas

| Provedor | Tarefa | Nota | Reps | Tokens entrada (média) | Tokens saída (média) | Latência média | Custo médio | JSON válido |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ollama qwen2.5:7b (local) | Prontidão | small | 1 | 853 | 179 | 7205 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Prontidão | medium | 1 | 1051 | 102 | 5321 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Geração de prova | small | 1 | 513 | 502 | 19308 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Geração de prova | medium | 1 | 513 | 502 | 19515 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Turno de conversa | small | 1 | 113 | 75 | 2877 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Turno de conversa | medium | 1 | 113 | 75 | 2964 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Avaliação de conversa | small | 1 | 1144 | 460 | 18564 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Avaliação de conversa | medium | 1 | 1165 | 658 | 26489 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Extração factual | medium | 1 | 905 | 1557 | 60119 ms | R$ 0,00 (local) | 100% |
| Ollama qwen2.5:7b (local) | Verificação factual | medium | 1 | 1247 | 2000 | 76550 ms | R$ 0,00 (local) | 0% |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Prontidão | small | 1 | 853 | 179 | n/d | R$ 0,0013 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Prontidão | medium | 1 | 1051 | 102 | n/d | R$ 0,0012 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Geração de prova | small | 1 | 513 | 502 | n/d | R$ 0,0021 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Geração de prova | medium | 1 | 513 | 502 | n/d | R$ 0,0021 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Turno de conversa | small | 1 | 113 | 75 | n/d | R$ 0,0003 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Turno de conversa | medium | 1 | 113 | 75 | n/d | R$ 0,0003 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Avaliação de conversa | small | 1 | 1144 | 460 | n/d | R$ 0,0025 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Avaliação de conversa | medium | 1 | 1165 | 658 | n/d | R$ 0,0031 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Extração factual | medium | 1 | 905 | 1557 | n/d | R$ 0,0059 (proxy) | n/d |
| DeepSeek V4.1 Flash (proxy: tokens do Ollama) | Verificação factual | medium | 1 | 1247 | 2000 | n/d | R$ 0,0076 (proxy) | n/d |

## Custo por fluxo

Contagem de chamadas extraída do código:

- **Prova (primeira sessão):** prontidão (1) + geração de prova (1) = **2 chamadas**.
- **Prova (sessão seguinte):** geração de prova (1) = **1 chamada**. A correção de prova é determinística e não usa IA.
- **Conversa:** prontidão (1) + primeira pergunta (1) + 3 a 5 turnos seguintes + avaliação final (1) = **6 a 8 chamadas** (a primeira pergunta já é o turno 1).
- **Verificação factual:** extração (1) + verificação (1) = **2 chamadas**.

Estimativa para o DeepSeek, usando o **proxy de tokens do Ollama** e o preço de tabela do DeepSeek:

| Fluxo | Chamadas | Custo estimado |
| --- | ---: | ---: |
| Prova (primeira sessão) | 2 | R$ 0,0033 |
| Prova (sessão seguinte) | 1 | R$ 0,0021 |
| Conversa (4 turnos) | 6 | R$ 0,0054 |
| Conversa (6 turnos) | 8 | R$ 0,0061 |
| Verificação factual | 2 | R$ 0,0135 |

## Leitura

- Prontidão: ~952 tokens de entrada e ~141 de saída.
- Geração de prova: ~513 de entrada e ~502 de saída.
- Avaliação de conversa: ~1155 de entrada e ~559 de saída.
- Verificação factual: ~1247 de entrada e ~2000 de saída.

A planilha assumia 2.500 tokens de entrada e 2.000 de saída por chamada. As chamadas medidas ficaram abaixo disso na maioria das tarefas. O schema JSON enviado pelo app não entrou neste benchmark, então os tokens reais do app serão maiores que os medidos aqui.
A verificação factual foi a exceção: bateu no teto de 2.000 tokens de saída e/ou devolveu JSON inválido no qwen local. Ela precisa de validação e retry no fluxo real.

## Limites da medição

- Uma amostra por tarefa/nota no Ollama; não é p50/p95.
- DeepSeek direto não foi medido (402). O proxy usa tokens do Ollama, que tem tokenizer diferente do DeepSeek; o custo é uma aproximação, não uma fatura.
- O conteúdo do usuário foi reconstruído a partir do código; pequenas diferenças de prompt podem mudar alguns tokens.
- O JSON válido mede apenas parse; não mede correção semântica nem grounding.
- Custo do Ollama é zero em API, mas não inclui energia, hardware ou tempo do usuário.

Resultado bruto: `docs/ai-benchmark-results.json`.
