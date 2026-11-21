# IA por conta (e o que é fornecido pela assinatura)

Estado: **chave e preferência já separadas por pessoa**; a IA gerenciada pela
assinatura (chave nossa, atrás do plano) tem a superfície pronta no app e o
backend ainda não existe.

## O problema

A chave de IA ficava na máquina. Numa máquina dividida — cônjuge, irmão, colega de
república estudando no mesmo PC — quem pagava a chave do Gemini pagava a revisão de
todo mundo, e a escolha de provedor de uma pessoa valia para a outra.

Regra que vale agora: **a chave de IA pertence a quem está usando o app**, não ao
computador.

## Como ficou

| coisa | onde | quem é |
|---|---|---|
| segredo (chave do Gemini / compatível OpenAI / TypeSafe) | cofre do Windows, nome `provider@<escopo>` | a pessoa |
| escolha de provedor e consentimentos | `localStorage`, chave `...v1:<escopo>` | a pessoa |
| IA gerenciada (nossa chave) | backend (a implementar) | a conta, pelo plano |

Escopo, resolvido no Rust (`ai_scope`):

1. `conta:<uuid>` — há sessão; o id vem do `sub` do JWT;
2. `pessoa:<id>` — convidado com identidade na máquina;
3. vazio — nada disso ainda (app recém-instalado): vale o nome antigo, sem sufixo,
   para ninguém perder a chave que já tinha configurado.

Entrar ou sair de uma conta recalcula o escopo. A tela de IA relê a preferência
quando a janela recebe foco — é o instante em que o fluxo de login do navegador
devolve o controle ao app.

## IA gerenciada: o que já existe e o que não

`src/features/review/managedProvider.ts` já define o **gate** (`managedAiGate`):
a opção "IA da assinatura" aparece desabilitada para plano gratuito, com mensagem
explicando o porquê, e o mesmo gate é aplicado na execução — a opção nunca aparece
liberada para quem seria negado. A cobrança está desligada (`isBillingEnabled`).

Falta, e é backend:

1. **Proxy de chamadas** — uma função de borda que receba o pedido, autentique a
   conta, injete a nossa chave e devolva a resposta. A chave nunca vai para o
   cliente.
2. **Cota e medição por conta** — o consumo precisa ser contado onde a chamada
   acontece, não no cliente (o cliente é do usuário). A heurística de custo do
   `managedProvider.ts` já espelha `usage.rs` e serve de estimativa.
3. **Flag do plano** — `isBillingEnabled` ligado e o plano reconhecido pela conta.

Enquanto isso, **Ollama local e chave própria funcionam sempre** e não passam por
gate nenhum: IA é extra, notas e revisão são locais.

## O que não fiz de propósito

- **Não migrei a chave antiga para uma conta.** Ela fica no escopo vazio (a
  máquina). Adotá-la para quem entrasse primeiro seria a mesma mistura que estamos
  desfazendo — e, na dúvida, cada conta configura a sua.
- **Não bloqueei o app sem IA.** Sem plano e sem chave, a revisão continua
  funcionando com o Ollama ou sem IA.
