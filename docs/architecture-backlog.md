# Backlog de arquitetura — MirrorMind (2026-09-03)

Pós candidatos 1, 2, 3 (vaultIndex), 4. `App.tsx` em 7.320 linhas; full 813/813.

## Fila recomendada

1. **Seam do índice do grafo** — `graphWikilinkIndexRef` (build próprio em
   2045/2057) + `vaultNoteContentsRef` (9 refs) ainda separados do
   `vaultIndex`. Continuação natural do candidato 3: unificar o pipeline de
   documentos do grafo sob o mesmo dono. Impacto alto / esforço médio.
2. **NoteReadinessControl (880 linhas)** — próximo módulo quente do review
   (3 commits recentes) ainda monolítico: prontidão + relatório + popover.
   Candidato a split painel/relatório. Impacto médio / esforço médio.
3. **Restos do App (abas, explorer)** — soft-delete, palette (~5) e parte do
   explorer ficam (retorno decrescente, ~10 dependências entrelaçadas).
   Só mexer se um bug apontar para lá. Impacto baixo / esforço alto.
4. **Detalhes visuais** — azul `#79a8ff` do dark ainda pendente de token;
   nada funcional. Impacto baixo / esforço baixo.

## Fora do escopo de código (lançamento)

Licença, Authenticode, gate M1 e 1ª tag (updater UI + secrets CI prontos).
Ver `docs/launch-roadmap.md`.

## Decisões travadas

- `ai.ts`: contratos zod ficam (fronteira de confiança, parte profunda).
- `prefs.ts`: `BasesPage`/`consentimentos` fora (vault-scoped próprio).
- Modal: `dismissable` default true; grafo usa portal (`aria-hidden` no `#root`).
- Candidato 2 reenquadrado: página não espelhava estado (11 useStates = UI
  local); extraído o ciclo de vida, não uma "view".
- Candidato 4 reenquadrado: só a derivação dos dados era sem-dono; o resto
  da pilha já tinha dono.
