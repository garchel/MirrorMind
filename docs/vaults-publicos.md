# Vaults públicos (material de curso distribuído)

> **Estado:** ideia registrada, **não implementada**. Este documento existe para
> não se perder entre versões. Nada aqui está no app hoje.

## O problema que isso resolve

Um cursinho, uma escola ou um professor produz um conjunto pronto de notas e quer
que os alunos **cheguem com o material já estudável** — dentro do MirrorMind, com
revisão espaçada, grafo e busca funcionando desde o primeiro dia.

O modelo do app já ajuda: **vault é uma pasta**. Distribuir material é distribuir
uma pasta. O que falta é o que a pasta precisa ser para poder ser compartilhada
sem virar bagunça.

## O desenho pretendido

Um "vault público" é um vault comum que chega com duas áreas:

| área | quem escreve | o que é |
|---|---|---|
| `curso/` (nome a definir) | **só o emissor** — o app bloqueia edição | material pronto: notas, anexos, tags |
| `meus-estudos/` | o aluno | anotações dele; nada aqui é tocado por atualização |

A separação existe porque a primeira atualização do curso apagaria o estudo do
aluno, ou o aluno corromperia o material — os dois jeitos de perder.

## Instalação e atualização

- **Instalar** = importar a pasta (zip ou diretório). Sem servidor envolvido.
- **Atualizar** = baixar o que mudou, comparando por **hash de conteúdo**. O motor
  de sync já faz exatamente isso; o que muda é a origem (arquivo em vez de bucket).
- **Arquivo do aluno não é sobrescrito:** nota editada dentro de `curso/` vira
  **cópia de conflito** com sufixo, como já acontece na sincronização. A base
  original é restaurada, e o trabalho do aluno sobrevive ao lado.
- **Manifesto** (`curso.json` na raiz da área gerenciada): autor, versão, data,
  hashes. Sem ele não há como atualizar nem conferir o que veio.

## O que o manifesto precisa dizer (e a interface precisa mostrar)

- **quem publicou** e **qual versão** está instalada;
- **licença** de redistribuição — isso é contrato com o parceiro, não código. O app
  pode exibir a licença e recusar instalar sem ela declarada;
- **o que é gerenciado** (lista de caminhos) — para o modo somente-leitura saber
  onde vale.

## Regras de produto

- **Local-first continua valendo**: depois de instalado, o vault funciona offline,
  sem conta, sem login. O material não depende do app para ser lido.
- **O aluno é dono do que escreveu.** Desinstalar o curso não apaga `meus-estudos/`.
- **Nada de conta obrigatória**: o canal de distribuição é o arquivo, não o login.
- **A conta não é usada para verificar acesso.** Se um dia houver material pago,
  é outro desenho (e outro documento).

## Fases (por que não agora)

1. **Importar vault pronto** — pasta/zip com área gerenciada somente-leitura.
   Sozinho já entrega valor e não depende de parceiro.
2. **Atualização com manifesto** — versões, hashes, cópia de conflito.
3. **Canal de parceiros** — catálogo, download, suporte. Só faz sentido com
   parceiro fechado; antes disso é código sem uso.

## Pré-requisitos que já existem

- `cloud.rs` / `cloud_sync.rs`: identidade por conteúdo, plano de sync, cópia de
  conflito, varredura de órfãos.
- Perfis por pessoa no vault (`profiles.rs`): progresso separado dentro do mesmo
  material.
- Identidade na máquina com espelho no vault (`identities.rs`).

## Pré-requisitos que faltam

- **Escrita bloqueada em caminho gerenciado** (hoje não há noção de "área do app
  que o usuário não edita").
- **Manifesto + versão** e a tela de conferência.
- **Importação de pasta/zip** com conferência de hash.
- **Tela de licença** e o texto que explica o que é gerenciado.

## Perguntas em aberto

- O aluno pode **abrir** nota da área gerenciada para leitura no editor? (Hoje o
  editor é sempre editável; bloquear exige um modo novo.)
- Um arquivo editado pelo aluno em `curso/` deve voltar como cópia ao lado, ou
  como nota em `meus-estudos/`? A segunda é mais organizada, a primeira é mais
  previsível.
- Vault público pode ter **perfis** (duas pessoas na mesma máquina estudando o
  mesmo curso)? Provavelmente sim, sem mudança: perfis separam progresso.
- Distribuição por Git (o cursinho versiona o próprio material) ou zip? Git dá
  atualização barata, mas exige que o público saiba usar Git — provavelmente não.
