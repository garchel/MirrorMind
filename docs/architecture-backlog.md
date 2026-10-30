# Backlog de arquitetura — MirrorMind (2026-09-03, números revistos em 2026-10-29)

Pós candidatos 1, 2, 3 (vaultIndex), 4. `App.tsx` em 6.176 linhas; full
1.204/1.204 (120 arquivos, medido em 2026-10-29).

## Fila recomendada

1. ~~**Seam do índice do grafo**~~ ✅ feito (`c06c6a1`): `vaultNoteContentsRef`
   removido, um só estoque de conteúdos no `vaultIndex`. Resta o índice
   próprio do grafo (`graphWikilinkIndexRef`, visão com escopo legítimo —
   construído ao abrir, patchado incremental) — só mexer se o pipeline do
   grafo for trocado.
2. ~~**NoteReadinessControl (880 linhas)**~~ ✅ feito: hook + relatório
   extraídos, componente com 391 linhas de render.
3. **Restos do App (abas, explorer)** — soft-delete, palette (~5) e parte do
   explorer ficam (retorno decrescente, ~10 dependências entrelaçadas).
   Só mexer se um bug apontar para lá. Impacto baixo / esforço alto.
4. **Detalhes visuais** — azul `#79a8ff` do dark ainda pendente de token;
   nada funcional. Impacto baixo / esforço baixo.

## Peso de inicialização (medido em 2026-10-29 com `npm run build`)

Bytes que o `dist/index.html` pré-carrega antes do primeiro pixel: o JS de
entrada, os 14 `modulepreload` e o CSS de entrada (16 arquivos), somando a
coluna `gzip` que o `vite build` imprime.

| | antes | depois |
| --- | ---: | ---: |
| JS + CSS no preload | 2.761 kB (826 kB gzip) | 2.211 kB (663 kB gzip) |

O que saiu do caminho de abertura (agora em chunk próprio, baixado quando a
tela pede):

- `vendor-rehype-katex` (260 kB / 78 kB gzip): `NoteReadinessReport` virou
  `React.lazy`; o chunk desce quando o menu de revisão abre, antes do
  primeiro "Avaliar nota".
- `vendor-katex` + `vendor-katex.css` (258 kB + 30 kB / 77 + 8 kB gzip): o
  editor importa `katex` dinamicamente na primeira fórmula. Enquanto o módulo
  não chega, a fórmula aparece como o `$...$` cru e é hidratada no lugar, com
  o mesmo DOM do caminho síncrono.

Não medido: tempo até a primeira nota. O número acima é de bytes, não de
relógio.

O que **não** saiu, e por quê:

- `vendor-codemirror-cm-lang-angular` (171 kB / 67 kB gzip) não é "peso do
  Angular": `@codemirror/lang-markdown` importa `@codemirror/lang-html`, que
  arrasta `lang-css`/`lang-javascript`, e o chunk do Angular compartilha o
  grupo. Remover `codeLanguages` do editor não tira o chunk e perde destaque
  de linguagem — não vale.

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
