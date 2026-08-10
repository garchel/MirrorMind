# Roadmap de Revisao e Aprendizado — V2 e Plano Pago

Este documento concentra as evolucoes de **V2** e as funcionalidades reservadas ao **plano pago** do sistema de revisao espacada e avaliacao por IA do MirrorMind. O roadmap funcional da V1 permanece em [review-learning-roadmap.md](review-learning-roadmap.md).

Legenda:

- Implementado: funcionalidade utilizavel na versao atual.
- Parcial: existe uma base, mas faltam partes importantes.
- Planejado: ainda nao foi implementado.

## Evolucoes V2 e plano pago

| Task | Estado | Criterio de conclusao |
| --- | --- | --- |
| Revisao de sintese | Planejado | Depois que as funcionalidades basicas de revisao estiverem consolidadas, avalia o modelo mental integrado da nota por meio da reconstrucao do cerne, das conexoes entre conceitos, da aplicacao em situacoes novas e da integracao das lacunas. Mantem pontuacoes separadas para cerne, conexoes, aplicacao e detalhes e pode ser acionada periodicamente, apos mudancas importantes ou perto de uma data-alvo. |
| Identificacao e priorizacao do cerne | Planejado | Na V2, identifica a ideia central e os conceitos essenciais da nota, permite explicar ao usuario por que foram considerados centrais e usa esse mapa para priorizar a avaliacao, ponderar a retencao e impedir que detalhes bem lembrados ocultem uma lacuna essencial. A V1 nao faz ponderacao semantica de cerne. |
| Impacto de dicas e contexto na retencao | Implementado | Separa dominio do conteudo e independencia de lembranca: a prova mapeia cada resposta dada com a dica exibida para a unidade dona do trecho (AssistedRecognition, peso 0.45 no DSR/FSRS) e a conversa que recorreu ao contexto vira AssistedConversation (0.85); o resumo informa "N com ajuda" e o relatorio expoe a evidencia assistida. |
| Sugestao de conhecimento extra pela IA (plano pago) | Planejado | Identifica informacoes relevantes trazidas pelo usuario durante a revisao que nao existem no Markdown, mantem essas informacoes fora da pontuacao e pergunta se o usuario deseja adiciona-las a nota. Nenhum conteudo e alterado sem confirmacao explicita. |
| Leitura multimodal para revisoes (plano pago) | Planejado | Antes de gerar perguntas ou avaliar respostas, interpreta imagens e PDFs referenciados pela nota e incorpora somente o conteudo desses anexos ao material permitido da sessao, indicando claramente quais fontes foram consideradas. |
| Provedores adicionais de IA | Planejado | Expande a camada de provedores alem de Gemini e Ollama, preservando o mesmo contrato de avaliacao fundamentada, privacidade e armazenamento seguro de credenciais. |
| IA gerenciada pela assinatura | Planejado | Antes da comercializacao, substitui a dependencia de chaves configuradas pelo testador por uma oferta gerenciada pelo MirrorMind, com o custo das chamadas de IA incluido na assinatura. As credenciais dos provedores permanecem no backend do servico e nunca sao distribuidas ao aplicativo cliente. |
| Medicao e protecao de custos da assinatura | Planejado | Antes de liberar assinaturas, mede uso por conta e provedor, define orcamentos e limites compativeis com o plano, protege contra abuso e automacao indevida, acompanha margem por usuario e informa de forma clara quando uma politica de uso for atingida. A telemetria economica nao deve armazenar o conteudo das notas, perguntas ou respostas. |
| Verificacao factual opcional | Planejado | Em uma operacao separada da avaliacao de memoria, compara afirmacoes da nota com fontes externas, apresenta as fontes e distingue claramente fatos confirmados, divergencias e incertezas. Nunca altera o Markdown sem aprovacao explicita e nunca modifica retroativamente pontuacoes de revisoes. A disponibilidade e o modelo comercial ainda serao definidos. |
| Sincronizacao multidispositivo do aprendizado (plano pago) | Planejado | Na V2, sincroniza entre computadores e notebooks somente os dados minimos de revisao vinculados a conta, enquanto o Markdown continua no Vault escolhido pelo usuario. Detecta versoes concorrentes e nunca escolhe ou sobrescreve silenciosamente um historico incompativel. Como os resultados podem conter trechos da nota, usa criptografia de ponta a ponta ou exclui esses trechos da copia em nuvem. Dispositivos moveis permanecem fora deste requisito ate serem planejados separadamente. |
