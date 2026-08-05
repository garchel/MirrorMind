# Contrato de Compatibilidade Obsidian V1

Este contrato define o que o MirrorMind pode abrir, editar e preservar em vaults do Obsidian na V1.

## Suportado para leitura e edicao

- Arquivos Markdown `.md` em qualquer pasta, exceto diretorios internos `.obsidian` e `.mirmind`.
- Frontmatter YAML como propriedades, inclusive listas, objetos e valores aninhados.
- Wikilinks para notas, caminhos, aliases, headings e blocos: `[[nota]]`, `[[pasta/nota]]`, `[[nota|alias]]`, `[[#heading]]` e `[[nota#^bloco]]`. Nomes duplicados preferem a nota mais proxima, caminhos explicitos partem da raiz e links inexistentes criam a nota correspondente.
- Tags no corpo e na propriedade `tags` do frontmatter, incluindo escalares, listas de bloco ou flow, aliases, sequencias YAML aninhadas, caminhos de tags, BOM e Unicode NFC/NFD. O mesmo conjunto normalizado alimenta o explorador, a nota ativa, a insercao, o autocomplete e os filtros do grafo; codigo, comentarios e fragmentos de URL nao entram no indice. A indexacao aplica limites de tamanho e quantidade para manter o Vault responsivo.
- Markdown CommonMark e GFM usado pelo editor: titulos, listas, checklists, citacoes, tabelas, links, imagens e blocos de codigo.
- Callouts do Obsidian, incluindo Markdown inline no titulo, aninhamento em blocos e listas e variantes recolhiveis `+` e `-`.
- Transclusoes de notas pelo mesmo pipeline Markdown seguro, com recortes por heading ou referencia de bloco e limites contra ciclos ou documentos hostis.
- PDFs incorporados e inventariados com visualizacao interna e navegacao por paginas, sem abrir um aplicativo externo. A leitura e confinada pelo backend ao Vault autorizado e aplica limites de tamanho e renderizacao.
- Anexos nativos de imagem, audio, video e PDF em qualquer pasta visivel do Vault. Novas importacoes respeitam a raiz, uma pasta fixa, a pasta da nota (`./`) ou uma subpasta da nota (`./pasta`) configurada em `.obsidian/app.json`. Embeds aceitam caminhos desde a raiz do Vault, caminhos relativos confinados e nomes curtos, que preferem o arquivo mais proximo da nota atual.
- HTML embutido do subconjunto permitido pelo sanitizador no modo de leitura; elementos e atributos inseguros sao descartados apenas na renderizacao.

## Preservado sem interpretacao

- Comentarios, ordem das chaves, aspas, anchors, aliases e campos YAML desconhecidos quando as propriedades sao salvas pelo editor YAML.
- Sintaxes de plugins, blocos especiais, comentarios Obsidian, extensoes desconhecidas e arquivos nao Markdown. O MirrorMind nao os remove nem reescreve intencionalmente.
- Arquivos dentro de `.obsidian/` e dados internos de plugins nao sao modificados nem entram nos indices editaveis. O resumo do Vault expoe somente uma whitelist tipada e limitada de preferencias de `app.json`; campos desconhecidos e dados de plugins nao sao serializados. Canvas, Excalidraw, `.excalidraw.md` e formatos desconhecidos fora de diretorios internos aparecem somente no painel read-only de compatibilidade; eles nao entram na arvore editavel de notas e seu conteudo nao e lido ou reescrito. A lista mostra no maximo 500 itens e sinaliza quando a coleta foi interrompida para proteger a responsividade do workspace.
- Ao renomear ou mover uma nota ou pasta, os wikilinks e embeds reconhecidos sao resolvidos contra a arvore anterior para preservar seus destinos. Alias, heading, referencia de bloco, extensao explicita, espacos e finais de linha permanecem intactos; ocorrencias dentro de codigo, comentarios HTML ou Obsidian, blocos HTML ou com escape nao sao interpretadas nem reescritas. A operacao aborta diante de Markdown ilegivel ou alteracao concorrente em vez de aplicar apenas parte das mudancas silenciosamente.

## Limitacoes conhecidas

- A renderizacao de Canvas, Excalidraw, anotacoes e recursos interativos de PDFs e transclusoes avancadas ainda nao e equivalente ao Obsidian.
- O frontmatter e preservado literalmente pelo editor YAML; editar a descricao da nota pode reserializar apenas as propriedades que ele administra.

## Garantia de seguranca

Se um recurso nao for interpretado, o MirrorMind deve preservar seu texto e sinalizar uma limitacao em vez de remove-lo, reformata-lo silenciosamente ou sobrescrever configuracoes do Obsidian.
