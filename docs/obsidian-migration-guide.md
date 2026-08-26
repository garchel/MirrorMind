# Migrando um vault do Obsidian para o MirrorMind

Você não precisa “migrar” nada: o MirrorMind abre a pasta do seu vault do
Obsidian direto e trabalha nos mesmos arquivos `.md`. Este guia explica o que é
reconhecido, o que é preservado intocado e as diferenças que vai notar.

## Abrindo seu vault

1. Abra o MirrorMind → **Abrir vault existente**.
2. Selecione a pasta do vault (a que contém `.obsidian/`).
3. O app detecta que é um vault Obsidian e mostra o inventário de notas,
   anexos e arquivos especiais. Nada é copiado nem movido — o app edita os
   mesmos arquivos da mesma pasta.

Você pode voltar ao Obsidian a qualquer momento; os dois apps convivem com o
mesmo vault (evite editar a mesma nota nos dois ao mesmo tempo).

## O que funciona direto

- **Notas `.md`**: leitura e edição com live preview por bloco.
- **Wikilinks completos**: `[[nota]]`, caminhos desde a raiz, aliases
  (`[[nota|apelido]]`), subheadings (`[[nota#seção]]`) e referências de bloco.
  Backlinks e links quebrados também são detectados.
- **Embeds**: `![[nota]]`, imagens e PDFs renderizam no modo Leitura (PDFs têm
  visualizador interno).
- **Callouts** `> [!tipo]`: ícones, cores, títulos e recolhimento.
- **Frontmatter YAML**: preservado byte a byte nas partes que você não edita
  (comentários, ordem, aspas, anchors/aliases). O painel de propriedades edita
  campos individuais sem reserializar o restante.
- **Tags**: corpo (`#tag`) e propriedade `tags` (escalar, lista ou flow),
  com normalização Unicode.
- **Anexos**: as quatro localizações do `attachmentFolderPath` do Obsidian são
  respeitadas (raiz, pasta fixa, `./` junto à nota, `./subpasta`).
- **Matemática KaTeX**, tabelas GFM, checklists e HTML sanitizado.

## O que é preservado intocado

- **`.obsidian/` nunca é modificado** — configurações, temas, atalhos e dados
  de plugins ficam exatamente como estão (validado byte a byte pela suíte de
  regressão).
- **Plugins não executam aqui**: blocos `dataview`, `dataviewjs` e `tasks`
  aparecem como cards *somente leitura* mostrando seu conteúdo; nada é
  calculado ou executado. JavaScript de plugin jamais roda no MirrorMind.
- **Canvas (`.canvas`) e Excalidraw**: visualização somente leitura da
  estrutura; a edição continua no Obsidian.
- **Sintaxe desconhecida** permanece literal no arquivo, sinalizada na
  interface — nunca removida ou reformatada silenciosamente.

## Diferenças esperadas

- Temas CSS e aparência personalizada do Obsidian não são aplicados; o
  MirrorMind tem tema claro/escuro próprio e pode importar algumas preferências
  visuais de `appearance.json` (tema, acento, tamanho base) como sugestões.
- Atalhos e command palette são próprios do MirrorMind (configuráveis na página
  Atalhos).
- Plugins da comunidade não têm equivalentes automáticos.

## Seus dados

Os metadados do MirrorMind (histórico, lixeira, revisão) ficam numa pasta
própria `.mirmind/` dentro do vault, separados do `.obsidian/`. Removê-la não
afeta suas notas nem as configurações do Obsidian. Sincronização (OneDrive,
Git etc.) continua funcionando normalmente sobre a mesma pasta.
