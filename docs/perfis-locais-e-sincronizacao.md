# Perfis locais (convidado) e sincronização — decisões

> Estado: **proposta em discussão**, nada implementado. Este documento existe para
> que as decisões fiquem registradas antes do código, não depois.

## A proposta

1. "Continuar sem conta" vira **"Continuar como convidado"** e leva a uma tela
   para criar um **perfil local**, offline.
2. Vários perfis por computador — resolve o caso de pessoas que compartilham o PC.
3. Um perfil convidado pode ser **vinculado** a uma conta (Google ou e-mail/senha).
4. Se o plano da conta cobrir **nuvem**, o vínculo oferece enviar os dados locais,
   com dupla confirmação.
5. Precisa de uma regra para saber se a nuvem é "mais atual/importante" que o
   local — ou oferecer **manter os dois** para não perder nada.

## O que existe hoje (fatos que a decisão precisa respeitar)

| dado | onde vive | escopo atual |
| --- | --- | --- |
| notas e anexos | arquivos na pasta do vault | pasta |
| aprendizado/revisão (FSRS) | `<vault>/.mirmind/learning/` | **pasta** |
| políticas de tag, calibração, metas, modelos, favoritos | `<vault>/.mirmind/*.json` | **pasta** |
| chaves de IA | keyring do Windows (serviço `com.mirrormind.desktop`) | máquina |
| preferências, tema, tamanho de fonte | `localStorage` da janela | máquina |
| plano/entitlement | cache em `localStorage` + servidor | conta |

Consequência direta: **hoje, duas pessoas que abrem a mesma pasta compartilham o
mesmo histórico de revisão.** É exatamente o problema que os perfis resolvem — e
resolvê-lo exige particionar `.mirmind/learning/` por perfil.

## Decisões que travam o código (precisam antes da primeira linha)

1. **Onde mora o estado do perfil.** Duas opções:
   - dentro do vault: `<vault>/.mirmind/learning/<perfil>/…` — o histórico viaja
     com a pasta e o mesmo vault pode ser usado por duas pessoas, cada uma com
     sua trilha;
   - no app: `%APPDATA%/<app>/profiles/<id>/…` — separação limpa, mas o histórico
     não acompanha a pasta (levar o vault para outro PC perde a revisão).
   **Recomendação:** dentro do vault, por perfil. Notas são compartilhadas;
   históricos não.
2. **Unidade de sincronização.** É o **vault** (com um dono/conta) ou o **perfil**?
   **Recomendação:** o vault, com o perfil como autor das mudanças. Sem isso, dois
   perfis na mesma pasta gerariam dois "donos" do mesmo arquivo.
3. **Guardamos o log de revisões ou só o estado?** O FSRS guarda um resumo
   (facilidade, intervalo, próxima data). Duas máquinas revisando a mesma nota
   produzem resumos incompatíveis. Com **log de eventos** dá para reconstruir;
   sem log, o merge só pode ser "vence o mais recente" — e isso perde histórico.
   **Recomendação:** log por nota (event sourcing) se a nuvem for multiusuário;
   "mais recente vence" com aviso se for single-device.

## Decisões de produto (não travam código, mudam a experiência)

| decisão | opções | recomendação |
| --- | --- | --- |
| Perfil tem senha/PIN? | aberto, PIN opcional, bloqueio por perfil | PIN **opcional** — sem isso, "perfil" dá privacidade falsa em PC compartilhado |
| Troca de perfil | só na abertura, ou a quente pelo menu | a quente (menu do perfil), com o vault atual mantido |
| Um vault, quantos perfis? | todos, um "dono", N com trilha própria | trilha própria por perfil (é o motivo de existir) |
| Excluir perfil | apaga histórico, mantém notas | apaga só o histórico do perfil + confirmação por digitação |
| Mesma conta em 2 perfis locais na mesma máquina | permitir, bloquear | bloquear (confunde a sincronização); oferecer "usar este perfil" |
| Vários perfis vinculados à mesma conta | permitir | permitir só se a nuvem também for multi-perfil — decidir junto com a cota |
| Nome do botão | "Continuar como convidado" | ✅ aprovado |
| Ordem do fluxo | perfil → vault, ou vault → perfil | **perfil → vault**: "quem sou" antes de "onde estão minhas notas" |

## Sincronização: o que decidir além de "qual é mais nova"

A pergunta "qual é mais atual" não tem resposta segura — data de modificação
mente (relógio, cópia de arquivo, sincronização anterior). O que dá para saber é
**o que mudou desde o último ponto comum**. Decisões que faltam:

1. **Merge por item, não por lado.** Nota a nota: se só um lado mudou, vale ele.
   Se os dois mudaram, **gera conflito** (cópia com sufixo "conflito") em vez de
   sobrescrever.
2. **Primeira sincronização de um convidado com conta que já tem dados.**
   **Recomendação:** oferecer "manter os dois" — cria dois vaults separados,
   `(local)` e `(nuvem)` — em vez de arriscar merge automático. Depois o usuário
   compara e decide.
3. **Revisão não faz merge por data.** Duas pessoas estudando a mesma nota não
   produzem um estado "mais novo": produzem dois históricos. Ver decisão 3 acima.
4. **O que entra na cota de nuvem.** Notas + anexos? Só notas? O que acontece ao
   estourar: para de subir (local continua) ou recusa a sincronização inteira?
   **Recomendação:** notas + anexos contam; ao estourar, para de subir e avisa —
   nunca apaga nada.
5. **Plano cai (inadimplência).** **Recomendação:** nuvem vira somente leitura por
   30 dias e depois só exportação; local nunca é afetado.
6. **Desvincular / sair da conta.** O perfil local continua funcionando sem plano.
   E o que acontece com a cópia na nuvem: fica (pode religar) ou é apagada?

## Riscos que ainda não apareceram na conversa

1. **Migração de quem já usa o app.** Quem tem vault hoje precisa acordar com um
   perfil automático ("padrão") e o mesmo histórico — migração silenciosa, sem
   tela e sem perder nada. Tem que estar no mesmo release dos perfis.
2. **Privacidade sem senha.** Dois perfis no mesmo PC = duas caixas abertas. Se a
   promessa é "privado", o PIN deixa de ser opcional.
3. **LGPD.** Perfil local não é conta e não gera dado no servidor — até o dia do
   vínculo. Nesse momento, enviar notas para a nuvem exige consentimento
   explícito (e o aceite de termos já existe no cadastro).
4. **Duas instâncias do app.** Se um perfil abre o mesmo vault em duas janelas,
   o `.mirmind/learning` de ambos escreve no mesmo lugar. Precisa de trava por
   vault+perfil.
