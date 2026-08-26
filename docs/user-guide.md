# Guia do usuário — MirrorMind

O MirrorMind é um app de notas **local-first**: suas notas são arquivos Markdown
reais numa pasta do seu computador (o *vault*), e nada é enviado para servidores.
Este guia cobre o essencial para começar e usar no dia a dia.

## Requisitos

- Windows 10 22H2 ou Windows 11 (x64).
- Espaço em disco mínimo; não exige conta nem internet (exceto recursos de IA,
  todos opcionais).

## Primeiros passos

1. Abra o MirrorMind. A tela inicial oferece dois caminhos:
   - **Abrir vault existente** — escolha uma pasta que já tenha notas
     `.md` (inclusive um vault do Obsidian; veja o
     [guia de migração](obsidian-migration-guide.md)).
   - **Criar novo vault** — informe um nome e escolha a pasta pai. O app cria a
     estrutura de metadados `.mirmind/` dentro da pasta.
2. Na próxima abertura, o app pergunta se quer reabrir o último vault (você pode
   marcar “não perguntar novamente”).

Seus arquivos continuam sendo arquivos comuns: você pode abri-los em qualquer
editor, sincronizá-los com o serviço que preferir (OneDrive, Git etc.) e levar
os vaults com você.

## Escrever notas

- **Nova nota**: botão na barra lateral ou `Ctrl+N`. Dê um título e pressione
  `Enter` para criar o arquivo.
- **Modos de visualização** (`Ctrl+M` alterna):
  - *Edição*: só o texto Markdown.
  - *Misto* (padrão): o parágrafo em foco mostra o Markdown; o resto fica
    renderizado (live preview por bloco).
  - *Leitura*: tudo renderizado, sem cursor.
- **Autossalvo**: por padrão a nota é salva sozinha após uma pausa curta de
  digitação (configurável em Configurações → Workspace). `Ctrl+S` salva na hora.
- **Formatação**: toolbar no editor (títulos, listas, citações, código, tabelas)
  e atalhos como `Ctrl+B` (negrito), `Ctrl+I` (itálico).
- **Busca dentro da nota**: `Ctrl+F`.
- **Corretor ortográfico**: pode ser ligado/desligado nas preferências de leitura.

## Conectar ideias

- **Wikilinks**: digite `[[` para autocompletar notas. Clique num link para
  navegar; links que ainda não existem criam a nota ao serem seguidos.
- **Backlinks**: cada nota mostra quem referencia ela (aba de backlinks).
- **Tags**: use `#tag` no texto ou a propriedade `tags` no frontmatter. Filtre o
  explorador por tags ou gerencie todas na página Tags.
- **Grafo**: a página Grafo mostra as conexões entre notas em 2D ou 3D, com
  filtros por pasta/tag e agrupamento visual.
- **Tabela (Bases)**: enxergue todas as notas como linhas, com as propriedades
  do frontmatter como colunas filtráveis e ordenáveis.

## Anexos e imagens

Arraste arquivos para o editor: eles são copiados para a pasta de anexos do
vault e inseridos como imagem/embed. Imagens locais e PDFs renderizam no modo
Leitura (PDFs têm visualizador interno com navegação por páginas).

## Revisar e aprender (opcional)

A página Revisão transforma notas em um sistema de repetição espaçada:

1. Abra uma nota e clique em **Avaliar nota** (usa IA — ver abaixo).
2. Quando a nota estiver “pronta”, ative a revisão. Ela entra na fila quando
   vencer o intervalo definido pela política (da nota, das tags ou do padrão do
   vault — configurável em Configurações → Revisão).
3. Conclua a prova (múltipla escolha/resposta curta ou conversa) e receba a
   pontuação, as lacunas destacadas na nota e a próxima data de revisão.

### IA

Os recursos de avaliação usam IA **só quando você aciona**:

- **Ollama local**: nada sai do computador.
- **Gemini / provedor compatível com OpenAI**: configure a chave nas Configurações
  → Revisão (a chave fica no cofre do sistema operacional, nunca no vault).
- Um orçamento mensal estimado em US$ limita as chamadas antes de estourar
  (padrão US$ 20, configurável).

## Produtividade

- **Command palette**: pesquisável com atalho configurável — cria nota diária,
  abre notas e executa comandos sem tirar a mão do teclado.
- **Notas diárias**: a nota do dia vive em `Diarias/AAAA-MM-DD.md`.
- **Templates**: Em branco, Nota de estudo e Reunião (ao criar nota).
- **Favoritos**: fixe notas no topo do explorador.
- **Atalhos**: veja e personalize tudo na página Atalhos do workspace.
- **Lixeira**: exclusões vão para `.mirmind/trash` e podem ser restauradas por
  até 30 dias.

## Onde ficam seus dados

| Local | Conteúdo |
| --- | --- |
| Dentro do vault (`.mirmind/`) | Configuração, histórico, lixeira, dados de revisão |
| Pasta de configuração do app | Preferência de último vault |
| Perfil local do WebView2 | Preferências de interface (localStorage) |

Desinstalar o app **nunca apaga** seus vaults ou notas.

## Problemas e sugestões

- Bugs: abra uma issue usando o template **Report de bug** no GitHub.
- Ideias e feedback: template **Sugestão de melhoria**.
- Detalhes de instalação: [página de download](download.md).
