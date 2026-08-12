## [2026-07-27] Feature/Task: Gerenciamento de tags
- **Issue:** Ao atingir o limite backend de 100 regras, o botão de criar continua disponível e o usuário só recebe o erro ao confirmar.
- **File(s):** `src/features/tags/TagManagementPage.tsx`
- **Category:** Edge Case
- **Criticality:** LOW
- **Effort:** SMALL
- **Context/Suggestion:** Desabilitar a criação quando `config.tagRules.length >= 100` e explicar o limite junto ao botão.
---

## [2026-07-27] Feature/Task: Gerenciamento de tags
- **Issue:** O modal de impacto possui semântica de diálogo, mas ainda não prende o foco nem fecha com Escape.
- **File(s):** `src/features/tags/TagManagementPage.tsx`
- **Category:** Edge Case
- **Criticality:** LOW
- **Effort:** SMALL
- **Context/Suggestion:** Adicionar foco inicial, contenção de Tab/Shift+Tab, restauração do foco ao fechar e tratamento de Escape quando a operação não estiver ocupada.
---
