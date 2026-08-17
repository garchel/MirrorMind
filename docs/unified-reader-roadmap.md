# Roteiro: motor único de renderização (modo Leitura = Misto read-only)

> Decisão (Caminho B): unificar os dois motores de renderização. Hoje o modo
> **Leitura** usa ReactMarkdown (remark/rehype) e o modo **Misto** usa a
> máscara do CodeMirror (Lezer GFM + decorations). Cada motor tem regras
> próprias — divergências como o divisor setext (`---` vira título no Leitura,
> divisor no Misto) já causaram bugs. Meta: o **Misto vira o superconjunto** e
> o **Leitura passa a ser o próprio Misto em modo read-only** (sem edição, sem
> caret, sem revelação de Markdown).

## Estado atual (levantado em agosto/2026)

### O que o Misto já renderiza (mantém)
- Formatação inline: negrito, itálico, riscado, código.
- Títulos ATX (`#`–`######`) e setext `===` (H1; `---` vira divisor).
- Citações `>` (barra lateral) — **manter o formato atual** (decisão do usuário).
- Bullets e tarefas `- [ ]` (widget visual).
- Fences de código (conteúdo preservado, marcadores ocultos).
- **Tabelas** (grade real editável, mesma aparência do Leitura) — **sem alterações**.
- **Matemática** KaTeX inline e em bloco — **sem alterações**.
- Divisor `---` (linha gráfica).
- Wikilinks `[[...]]` e links `[texto](url)` como **texto estilizado (não clicáveis)** — muda neste roteiro.

### O que falta ao Misto (vem do Leitura) — marcos abaixo
1. **Links clicáveis** (navegam quando o cursor não está perto).
2. **Imagens** `![](...)` (hoje aparecem cruas).
3. **Embeds de nota** `![[...]]` e **PDFs** (hoje viram link estilizado).
4. **Callouts** `> [!tipo]` (hoje citação simples).
6. **Blocos de plugin** (Dataview/Tasks; hoje cru).
7. **Checkbox alternável** (hoje widget visual; o Leitura alterna com clique).
8. **Frontmatter colapsado** (hoje cru no topo; ver design abaixo).

### Restrições técnicas (validadas no código)
- Plugins de view **não podem** substituir quebras de linha (RangeError) nem
  fornecer widgets de bloco — só StateFields (a tabela já usa esse padrão).
- Decorações `mark` não têm handler de clique — só widgets (`WidgetType`) têm.
- `ignoreEvent() { return true }` no widget faz o CodeMirror ignorar o clique
  (não posiciona cursor) — o próprio DOM trata a navegação.
- Widgets são recriados quando `eq()` falha; capturar callbacks via getter
  (`getOpenLink`) evita handlers obsoletos entre re-renders do React.

## Marcos

### 1. Links clicáveis no Misto ✅ implementado
- `LinkWidget` substitui o conteúdo interno do token `link`/`wikilink` quando a
  máscara está ativa (cursor longe); com o cursor perto, o token revela o
  Markdown cru (fluxo de edição preservado).
- `markdownLivePreview` virou factory que recebe `getOpenLink` (getter do
  callback de navegação via ref do componente — nunca fica obsoleto).
- Alvos:
  - Wikilink `[[caminho|alias]]` / `[[caminho#fragmento]]` → nota.
  - Link Markdown `[texto](https://...)` → URL externa; prefixo
    `https://mirrormind.local/note/` → nota interna (mesmo contrato do Leitura).
- App: `onOpenLink` no editor Misto — nota → `openWikiLink(path, fragment)`;
  URL externa → `window.open(href, '_blank')`.
- **Detalhe técnico**: o Lezer cria nós `Link` para a sintaxe `[[...]]`
  (reference-like) que se sobrepõem ao wikilink por regex; a montagem dos
  tokens agora exclui os nós da árvore que sobrepõem um wikilink (o regex é o
  correto — alvo, alias e fragmento).
- Testes: clique navega sem foco; cursor perto revela cru (sem widget); alias e
  fragmento parseados; links externos vs internos (4 testes novos).
- **Decisão pendente**: o widget exibe o texto interno cru (ex.:
  `pasta/nota|alias`); Obsidian mostra o alias ou o último segmento. Melhorar
  o display num ajuste futuro.

### 2. Imagens no Misto ✅ implementado
- Widget `img` substituindo o nó `Image` do Lezer — cobre `![alt](url)` E o
  embed Obsidian `![[caminho|legenda]]` (o Lezer representa ambos como
  `Image`; a legenda/path são extraídos das marcas `LinkMark`).
- URL remota renderiza direto; ativos do vault (`mirrormind.local/asset/`,
  como o Leitura converte) são resolvidos via `getAssetUrl`/`resolveAssetUrl`
  (convertFileSrc no app), com guarda de travessia (`..`, `/`).
- Dedupe: o token `image` vence sobre o `Link` da árvore e o wikilink por
  regex sobrepostos (`![[...]]` gerava ambos).
- Revelação preservada: cursor perto mostra o Markdown cru (edição).
- CSS `.cm-live-image` com o mesmo visual do Leitura (max-width/height, borda).
- 5 testes novos (remota, embed simples, embed com caminho/legenda, revelação,
  read-only).

### 3. Embeds de nota e PDF no Misto ✅ implementado
- Widget de BLOCO (StateField, como a tabela) substituindo a linha inteira de
  `![[nota]]` / `![[arquivo.pdf]]`; detecção textual com as mesmas exclusões da
  tabela (frontmatter, fences, código indentado, linhas de tabela) — imagens
  `![[arquivo.png]]` continuam com o widget de imagem.
- **Nota**: placeholder → leitura assíncrona via `getEmbedContent` (dedupe de
  leituras em voo) → editor ANINHADO somente leitura com o MESMO motor
  (`markdownLivePreview` com profundidade + 1, linguagem GFM incluída — sem
  ela a árvore fica vazia e a máscara não encontra os tokens). Fragmento
  `#seção` aplicado via `extractObsidianEmbedFragment`.
- **PDF**: reutiliza `ObsidianPdfEmbed` (pdfjs + canvas) renderizado via React
  (`createRoot`) dentro do DOM do widget; precisa de `vaultPath` na opção.
- Limites iguais ao Leitura: `maxEmbedDepth` (4), `maxNoteEmbeds` (16),
  `maxPdfEmbeds` (4) — além do limite o bloco mostra a mensagem estática
  (mesmo texto do Leitura) sem buscar conteúdo.
- A sintaxe NUNCA é revelada (mesma decisão da tabela): edite a linha no modo
  Edição. `requestMeasure` após o conteúdo assíncrono para o bloco crescer.
- App: `resolveMixedEmbedBody` (read_note + corpo sem frontmatter) e `vaultPath`
  passados aos dois editores (Misto e spike).
- 6 testes novos (corpo formatado com editor aninhado, fragmento, nota ausente,
  imagem continua imagem, limite de profundidade via factory, PDF mockado,
  read-only).
- **Ajuste (feedback do usuário)**: o embed usa `width: 100%` (sem o limite de
  820px do Leitura) e o scroller aninhado usa `overflow-x: auto` — o conteúdo
  da nota incorporada não é mais cortado à direita (formulas longas rolam).

### 4. Callouts no Misto ✅ implementado
- Widget de BLOCO (StateField, como a tabela/embed) detectado por texto:
  `> [!tipo]` (+ fold `+`/`-` e título opcional) seguido de linhas de citação;
  mesmo visual do Leitura — o widget renderiza o `ObsidianCallout` (ícone,
  rótulo e fold nativo `<details>/<summary>`) via React (`createRoot`).
- Conteúdo: editor aninhado somente leitura com o mesmo motor (profundidade
  + 1) — tabelas, embeds e callouts aninhados funcionam lá dentro (o embed
  externo pula linhas cobertas por callouts; tabelas não iniciam em linhas `>`).
- Limite de profundidade `maxCalloutDepth` (24, como o Leitura): além dele o
  callout vira citação simples (mesma decisão do Leitura).
- Detalhe técnico: `flushSync` não comita o `createRoot` de forma síncrona no
  jsdom — o editor aninhado é anexado após o commit do React (setTimeout 0,
  mesmo padrão do embed de PDF).
- 7 testes novos (callout básico com conteúdo formatado, fold `-`/`+`, título
  customizado, citação normal permanece citação, read-only, tabela dentro de
  callout, embed de nota dentro de callout).

### 5. HTML sanitizado no Misto ✅ implementado
- HTML **inline** (`<mark>`, `<kbd>`, `<sup>`, `<a>`, ...) vira um token
  `html` que cobre o elemento inteiro (abertura→fechamento, via pilha de tags
  no walker) e é renderizado por um **`HtmlWidget`** que sanitiza com a mesma
  base do schema do Leitura (rehype-sanitize defaultSchema + mark).
- Sanitizador por allowlist (`sanitizeHtml`): tags fora da lista são
  **desembrulhadas** (texto/filhos preservados), tags perigosas
  (script/style/iframe/object/form/svg/math...) removidas por inteiro,
  atributos filtrados (sem `on*`, sem `href`/`src` `javascript:`/`data:`),
  comentários removidos.
- Cursor perto revela o HTML cru (edição preservada, como os demais widgets).
- **Blocos HTML multilinha** (`HTMLBlock`) permanecem crus: o plugin de view
  não pode substituir quebras de linha (limitação já documentada) — o token
  só renderiza quando cabe numa única linha.
- **Dedupe**: HTML aninhado (`<a><b>x</b></a>`) — só o token mais EXTERNO
  renderiza (o par interno é coberto pelo externo).
- 6 testes novos (sanitização de tag perigosa, desembrulho de tag desconhecida,
  atributo perigoso removido, revelação com cursor, bloco multilinha cru,
  aninhamento).

### 6. Blocos de plugin no Misto ✅ implementado
- Fences com linguagem de plugin (```` ```dataview ````, ```` ```dataviewjs ````,
  ```` ```tasks ````) viram um widget de BLOCO (StateField, como tabela/embed/
  callout) que reutiliza o `ObsidianPluginBlock` do Leitura: título, aviso de
  segurança e fonte crua preservada. `dataviewjs` nunca é executado.
- Detecção textual (`findPluginBlockSpecs`): linha de abertura com linguagem
  de plugin + fechamento da fence (``` / ~~~); fences incompletas ficam como
  bloco de código comum (cru). A sintaxe NUNCA é revelada (mesma decisão da
  tabela: edite no modo Edição).
- `buildDecorations` pula as linhas cobertas (como tabela/embed/callout) — o
  token `fence` do walker não decora o bloco.
- CSS `.cm-live-plugin-block` com largura total (o CSS do componente já vem
  com o import dele).
- 7 testes novos (dataview com fonte crua, tasks com ✓/○, dataviewjs com
  aviso de segurança, fence normal continua código, nunca revela com o cursor
  perto, bloco dentro de callout no editor aninhado, read-only).

### 7. Checkbox alternável no Misto ✅ implementado
- `CheckboxWidget` agora alterna a tarefa no documento: clique (mousedown) ou
  Espaço/Enter com foco alternam `[ ]` ↔ `[x]` via `view.dispatch` (mesmo
  efeito do toggle do Leitura, inclusive no modo read-only — dispatch
  programático não passa pela guarda de readOnly). `tabindex=0` + role/aria
  para acessibilidade.
- **Bug pré-existente corrigido**: o token `bullet` se estendia até o fim do
  colchetes (`markerEnd = taskMark.to`), sobrepondo (e escondendo) o widget de
  checkbox — o checkbox nunca era renderizado no Misto. Agora o bullet cobre
  apenas `- ` e o `[ ]`/`[x]` fica com o seu próprio widget.
- 5 testes novos (clique alterna, marcado→desmarcado preservando o texto,
  teclado, read-only, e unitário garantindo que o bullet não sobrepõe o
  marcador).

### 8. Frontmatter no cabeçalho (design do usuário) ✅ implementado
- O YAML inicial (`---`...`---`) **não fica no topo da nota**: no documento
  o bloco é substituído por um **espaço invisível** (`FrontmatterHiddenWidget`,
  zero altura) — o YAML cru nunca é exibido em lugar nenhum.
- O **header** (modo Misto) tem apenas o **arrow down** (sem texto "YAML · …"
  nem barra de resumo), **posicionado em cima da borda inferior** do header
  (`position: absolute; bottom: -14px`, metade para dentro, metade para fora).
- **Expandir**: clicar no arrow down — o **menu integrado**
  (`FrontmatterPanelForm`) aparece **dentro do próprio header** (linha própria
  do grid, `grid-column: 1/-1`), **sem borda, título nem botões
  Recolher/Cancelar/Aplicar**, parecendo parte dele. O painel abre com
  **animação slide-down** (`frontmatter-menu-slide-down`): a linha cresce e a
  **borda inferior do header desce junto com o arrow** (respeita
  `prefers-reduced-motion`). A animação anima **apenas `max-height`** (layout
  puro) — sem `transform`/`opacity`, que promovem o painel a uma camada de
  composição própria e, ao criar/remover essa camada a cada expandir/recolher,
  disparam o bug do WebView2/Chromium do **cursor I-beam branco/invisível**
  sobre a área de texto do editor logo abaixo (bug de composição MPO do
  Windows). O cursor da área editável também é declarado explicitamente
  (`cursor: text` no `.cm-content` do Misto). Além da prevenção (animação sem
  camada), o App ganhou uma **recuperação do cursor na troca de página**
  (efeito em `workspacePage`): um instante de `cursor: auto !important` em
  tudo força o compositor do WebView2 a redesenhar o cursor nativo depois de
  mudanças de composição (a Tabela tem colunas fixas/sticky e o grafo monta
  um canvas WebGL — mesmos gatilhos do bug "cursor branco/invisível" do
  Windows, cujo workaround clássico é minimizar/restaurar a janela). A
  recuperação foi generalizada para **qualquer entrada na superfície do
  editor** (explorador → editor): uma delegação de `mouseover`/`mouseout`
  reemite o cursor ao cruzar para dentro do `.editor-surface` (onde o cursor
  muda para o I-beam — outro gatilho conhecido). A função `nudgeCursor` é
  compartilhada pelos dois casos (30-40ms de `cursor: auto !important`).
  O painel usa um **grid de 2 colunas**
  (**Tags** à esquerda | **Propriedades** à direita) para ocupar melhor a
  largura do header, com **Referenciada por** (backlinks clicáveis) embaixo,
  na largura toda. O campo de **valor tem a mesma altura do campo de nome**
  (mesmo line-height 1.45).
- **Botão "+" de Tags**: abre um popover com **campo de digitação na primeira
  linha** (autofoco; conforme digita, filtra as **tags existentes** — máximo
  de 5 visíveis em 1 coluna, lista scrollável **sem rolagem lateral**,
  nomes longos truncam com reticências); **Enter cria a tag com o que foi
  digitado** (ou clique numa sugestão aplica a tag). Exclui tags já
  aplicadas. O conteúdo do popover é **portalado fora** do `.workspace-shell`,
  então os estilos (claro e escuro) partem de `.ui-popover-content`.
- **Badges removíveis**: cada badge de tag tem um **botão ✕ dentro dela**, à
  direita do nome, revelado no **hover** (também aparece com `:focus-within`);
  clicar remove a tag da nota (`removeTag`, gravação ao vivo). O ✕ ocupa
  **sempre** seu espaço na badge (16px fixo; só a opacidade muda no hover),
  então a badge **nunca muda de tamanho ao expandir** — uma badge na borda da
  linha não estoura a largura máxima nem quebra o wrap do layout.
- **Largura total**: o menu (e o painel) esticam na largura toda do conteúdo
  do header (sem `justify-items: center`; `width: 100%` no collapse e no
  painel), respeitando as mesmas margens do eixo x do header (`max(40px, 7vw)`
  do padding do próprio header).
- **Sem separadores** entre as seções do menu (sem bordas entre Tags,
  Propriedades e Referenciada por) — apenas os rótulos, para o menu parecer
  parte do header. Animações suavizadas: **slide-down** da barra com easing
  `cubic-bezier(0.22, 1, 0.36, 1)` em 300 ms e **rotação do arrow** em
  280 ms com easing elástico suave (`cubic-bezier(0.34, 1.2, 0.64, 1)`).
- **Botão "+" de Propriedades**: abre um popover **apenas com os ícones** das
  propriedades comuns (ex.: telefone → `phone`; tooltip com rótulo/chave); ao
  clicar, a linha chega com o **ícone** e a chave preenchida (fallback
  genérico para chaves customizadas).
- **Gravação ao vivo**: sem botão Aplicar, qualquer mudança nas linhas
  (digitar, adicionar, remover) grava no rascunho após ~400 ms de debounce
  (`applyFrontmatterPanel` preserva o restante do YAML byte a byte).
  Aplicar uma tag usa `applyExistingTag`.
- **Recolher**: arrow down de novo. O arrow fica **exatamente em cima da
  borda inferior do header** (ancorado no header, `bottom: -15px`, centro na
  linha da borda) e o hover **não o movimenta** (a regra global
  `button:hover` aplicaria `translateY(-1px)` e quebraria o centramento — o
  centramento é mantido explicitamente; o único efeito de transform é o giro
  de 180° quando aberto). O painel fecha ao trocar de nota ou de modo.
- Leitura read-only: sem arrow/menu (o Leitura nem recebe frontmatter, usa
  `noteBody`).
- **Removido**: o widget de frontmatter dentro do editor (barra clicável,
  keymap de ArrowUp/Down, painel via createRoot), o texto/barra de resumo do
  header, as tags abaixo do título (`note-tag-list`) e o `NoteTagPicker` no
  painel (substituído pelo popover de tags com campo + sugestões).
- 15 testes novos/atualizados (bloco oculto no doc, sem YAML cru, notas sem
  frontmatter intactas, read-only oculto, painel com Tags/Propriedades,
  gravação ao vivo, popover de propriedades só com ícones, criação de tag com
  Enter, sugestão clicável, remoção, backlinks, remoção de tag pelo ✕ da
  badge) + 5 regressões atualizadas (menu abre pelo arrow down dentro do
  header, tags no menu, propriedade multilinha aplicada ao vivo, metadados,
  remoção de tag pela badge grava ao vivo).

### 9. Leitura = Misto read-only 🧪 spike implementado
- **Capacidade pronta no editor**: prop `readOnly` no `MarkdownCodeEditor` →
  `EditorState.readOnly` + `EditorView.editable.of(false)` (sem caret, sem
  seleção, sem edição); máscara sempre ativa (`buildDecorations` ignora o
  caret quando `view.state.readOnly`); tabela sem grips e sem edição de célula;
  links continuam clicáveis.
- **Exposição no app (temporária)**: no modo Leitura, botão
  "Testar novo motor" na barra de modos alterna entre o Leitura clássico
  (ReactMarkdown) e o novo motor (Misto read-only) usando `noteBody`
  (frontmatter fora do topo, como planejado).
- **Lacunas da revisão (gap marks) integradas**: o campo `reviewGapField`
  aplica decorações `cm-live-gap` (forgotten/confused) nos offsets exatos das
  lacunas + badges de pontuação por unidade (widgets `review-unit-score`), com
  os 3 modos de exibição do clássico (sempre/hover/off) e a mesma condição
  `!isDirty`. Guardas de paridade: lacunas multilinha, dentro de fences,
  matemática display e dos blocos substituídos (tabela/embed/callout/plugin/
  frontmatter) são puladas. Dados chegam via getter + `reviewGapDataEffect`
  (fetch assíncrono sem recriar o editor); offsets deslocados pelo frontmatter
  quando o doc não o tem (spike usa `noteBody`).
- **Marcos 1–8 concluídos + lacunas da revisão integradas**: links, imagens,
  embeds, callouts, HTML sanitizado, blocos de plugin, checkbox, frontmatter
  colapsado e as **gap marks** (marcas `cm-live-gap` + badges de pontuação por
  unidade, com os 3 modos de exibição sempre/hover/off). O novo motor agora
  cobre tudo o que o Leitura clássico renderiza.
- **Renderer clássico aposentado (Marco 10)**: o Leitura é o Misto read-only
  de vez — o article ReactMarkdown e as funções `renderMarkdownDocument`/
  `renderMarkdown`/`renderMarkdownInline` foram removidos, junto com o botão
  "Testar novo motor" e todo o CSS/estado mortos (ver Marco 10).
- Decisão pendente: **seleção/cópia de texto** no Leitura read-only
  (`editable=false` bloqueia; `readOnly` mantém cópia mas permite caret).

### 10. Renderer clássico (ReactMarkdown) aposentado ✅ implementado
- O modo Leitura passa a renderizar SEMPRE pelo motor único (Misto read-only):
  o `<article>` ReactMarkdown, `renderMarkdownDocument`/`renderMarkdown`/
  `renderMarkdownInline`, o estado/botão `spikeReadEngine` ("Testar novo
  motor") e as constantes `MAX_CALLOUT_DEPTH`/`MAX_EMBED_DEPTH`/
  `MAX_EMBEDS_PER_NOTE_RENDER`/`MAX_PDF_EMBEDS_PER_NOTE_RENDER`/
  `MAX_RICH_MARKDOWN_LENGTH`/`MARKDOWN_SANITIZE_SCHEMA` foram removidos do
  App. Imports órfãos limpos (ReactMarkdown, remark/rehype, sanitize,
  ObsidianCallout/NoteEmbed/PdfEmbed/PluginBlock, normalizePluginLanguage,
  annotateReviewMarkdown, renderWikiLinksAsMarkdown, Fragment...).
- O preview de wikilinks por hover (`wikiLinkPreview`/`show/hideWikiLinkPreview`)
  era exclusivo do article clássico e foi removido — o novo motor navega no
  clique (fragmento incluso) sem tooltip de pré-visualização.
- `MarkdownCodeEditor` ganhou a prop `lineWrap` (default true): o Leitura
  respeita a preferência `reading-line-wrap`; o Misto continua sempre com wrap.
- `scrollToWikiHeading` (fragmentos `#seção`/`^blockid`) agora consulta o DOM
  do motor único: títulos são spans `cm-live-hN` (nível lido da classe) e
  blocos são `.cm-line`.
- **Integrações corrigidas ao remover o clássico** (comportamentos que só o
  renderer antigo cobria):
  - `openWikiLink` resolve `[[alvo]]` sem extensão contra o inventário
    (fallback com `.md`; `[[#fragmento]]` sem caminho vira a nota atual).
  - `resolveMixedEmbedBody` normaliza `![[nota]]` → `nota.md`.
  - Título de callout com markdown inline (`**Aviso** *seguro*`) é formatado
    no widget (`renderCalloutTitle`) — mesma aparência do clássico.
  - Embeds de arquivos `.obsidian` são ignorados (o clássico os excluía via
    inventário de anexos).
  - Busca (Ctrl+F) no Leitura não mexe no editor (offsets do texto-fonte não
    batem com o doc `noteBody`); navegação segue pelo DOM, como antes.
- CSS morto removido (regras `.markdown-reading`, `mark[data-gap]`,
  `is-line-wrap-disabled`, centralização de 820px, tema escuro do article).
- Testes do App.regression migrados para o DOM do motor único (links com
  `role=link`, matemática via `.cm-live-math`, callouts via widget,
  lacunas via `.cm-live-gap`).
- **Nota**: as páginas de review (`ReviewSessionPage`, `NoteReadinessControl`)
  ainda usam ReactMarkdown para renderizar relatórios gerados por IA —
  escopo separado; as dependências (react-markdown/remark/rehype) permanecem
  no package.json até essas páginas migrarem.

## Riscos e decisões abertas
- **Cópia/seleção** no Leitura read-only (`editable=false` bloqueia;
  `readOnly` mantém cópia mas permite caret).
- **Preview de wikilink por hover** (tooltip com resumo da nota) — era do
  article clássico; o motor único navega no clique sem o tooltip.
- **Settings de leitura**: `readingFont`/`readingWidth` hoje afetam apenas
  `--reading-max-width` (tabelas do motor); a fonte segue a do editor.
- **Embeds assíncronos**: cache, invalidação com o watcher, loops de embed.
- **Links externos**: navegar no webview vs navegador do sistema.
- **Performance**: widgets por token (links) vs marks — medir em notas grandes.
- **Acessibilidade**: widget clicável precisa de papel de link + teclado.

## Ordem de execução sugerida
1. Marco 1 (links clicáveis) — destrava o padrão de widget + factory.
2. Marco 9 (Leitura read-only) — spike com o que já existe (sem links/imagens
   extras) valida a arquitetura cedo.
3. Marcos 2 e 3 (imagens, embeds).
4. Marco 4 (callouts), 8 (frontmatter), 7 (checkbox) e 5 (HTML).
5. Marco 6 (blocos de plugin) e integração das lacunas da revisão.
6. **Aposentar o renderer ReactMarkdown** (Marco 10) ✅ — o Leitura é o
   Misto read-only de vez.

## Verificação
- Testes de render do Misto (links, imagens, embeds, callouts).
- Regressão: App.regression.test.tsx, markdownLivePreview.render.test.tsx.
- Suíte completa frontend (vitest) + Rust (se IPC de embed for alterado).
- E2E: jornada de abertura de nota em cada modo.
