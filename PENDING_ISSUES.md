## [2026-07-27] Feature/Task: Gerenciamento de tags
- **Issue:** A transação reverte falhas observadas em tempo de execução, mas ainda não possui diário durável para recuperar automaticamente uma interrupção abrupta entre substituições de várias notas.
- **File(s):** `src-tauri/src/tag_management.rs`
- **Category:** Edge Case
- **Criticality:** HIGH
- **Effort:** LARGE
- **Context/Suggestion:** Persistir um journal da operação antes do primeiro commit, registrar hashes dos originais e concluir ou reverter backups remanescentes na próxima abertura do vault, seguindo o padrão já usado pela persistência de aprendizado.
---

## [2026-07-27] Feature/Task: Gerenciamento de tags
- **Issue:** Renomear ou remover uma tag no frontmatter normaliza a propriedade `tags` e pode descartar comentários ou estilo de formatação existentes dentro dessa propriedade.
- **File(s):** `src-tauri/src/tag_management.rs`
- **Category:** Code Quality
- **Criticality:** MEDIUM
- **Effort:** MEDIUM
- **Context/Suggestion:** Evoluir o reescritor para operar sobre intervalos dos escalares YAML, preservando comentários, aspas e formatação quando a estrutura for suportada; rejeitar explicitamente estruturas que não possam ser reescritas sem perda.
---

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

## [2026-07-27] Feature/Task: Seletor de tags da nota
- **Issue:** Ao aplicar uma tag, o seletor usa a extra??o atual de tags do Markdown; um fragmento de wikilink como `[[#Titulo]]` pode ser interpretado como tag e ser gravado no frontmatter.
- **File(s):** `src/App.tsx`, `src/lib/markdown.ts`
- **Category:** Edge Case
- **Criticality:** MEDIUM
- **Effort:** MEDIUM
- **Context/Suggestion:** Ajustar o extrator para ignorar fragmentos de wikilinks antes de reutilizar tags extra?das para reescrita do frontmatter.
---
