# Passo a passo — contas de usuário (Google + Supabase)

> Para quem vai executar, não para quem escreveu o código. Cada etapa diz **o que
> clicar**, **o que copiar** e **como saber que deu certo**. Se algo mostrar
> diferente do descrito, pare e me diga — o console do Google muda de lugar com
> frequência.

## Antes de começar: o que é cada peça

Três peças, três papéis:

| peça | papel | analogia |
| --- | --- | --- |
| **Supabase** | guarda as contas (e-mail, senha, plano) | o cartório |
| **Google** | confirma "esta pessoa é dona desta conta Google" | o reconhecimento de firma |
| **MirrorMind** | pede a confirmação e guarda o crachá | quem apresenta o documento |

O app **nunca** vê a senha do Google. Ele recebe do Supabase um "crachá"
(token) dizendo quem é a pessoa. É por isso que o Google precisa confiar no
Supabase — e é isso que a Etapa 2 configura.

Projeto já criado: **`mirrormind`**, região São Paulo (`sa-east-1`).

---

## Etapa 1 — Copiar as chaves do Supabase (3 min)

1. Abra <https://supabase.com/dashboard/project/uzxpeoxrvdcptvbepzua/settings/api-keys>
2. Na lista, procure a chave **`publishable`** (nome `default`, começa com
   `sb_publishable_`).
3. Copie o **Project URL** (no topo da página): deve ser
   `https://uzxpeoxrvdcptvbepzua.supabase.co`.

Essas duas coisas **podem** ficar dentro do app: são a identificação pública do
projeto, como o número da loja. O que **nunca** entra no app é a
`service_role`/`secret` — essa fica só no servidor.

✔️ **Deu certo se:** a URL termina em `.supabase.co` e a chave começa com
`sb_publishable_`.

---

## Etapa 2 — Criar o acesso do Google (15 min)

Esta é a etapa chata: quatro telas no console do Google.

### 2.1 Criar o projeto

1. Abra <https://console.cloud.google.com/projectcreate>
2. Nome: `MirrorMind`
3. **Create**. Espere alguns segundos e confirme que o seletor no topo mostra
   `MirrorMind`.

### 2.2 Configurar a tela de consentimento

1. Abra <https://console.cloud.google.com/auth/overview>
2. **Get started** (ou "Configurar")
3. Preencha:
   - **App name:** `MirrorMind`
   - **User support email:** seu e-mail
   - **Audience:** **External** (pessoas de fora da sua organização)
   - **Contact email:** seu e-mail
4. Aceite a política e **Create**.

> "External + Testing" serve para o beta: até 100 e-mails de teste entram sem
> revisão do Google. Para abrir ao público, é um botão **Publish** — os escopos
> que usamos (`email`, `profile`) não são sensíveis, então não há auditoria.

### Por que "Web application" e não "Desktop app"

O produto é instalado no computador, mas **quem conversa com o Google é o
Supabase**, não o app: o Supabase é o cliente OAuth que recebe o código de
autorização em `https://<projeto>.supabase.co/auth/v1/callback` e troca esse
código por um token usando o *client secret*. O app nunca vê esse secret.

A documentação do Google diz que apps de desktop usam **redirect local** (loopback)
— o tipo "Desktop app" só aceita `http://localhost`/`http://127.0.0.1` como
retorno, e não tem "Authorized JavaScript origins". Como o retorno aqui é um
endereço `https` do Supabase, o tipo correto é **Web application**.

| se escolher | o que acontece |
| --- | --- |
| Web application | funciona: o callback `https://…supabase.co/auth/v1/callback` é aceito |
| Desktop app | `redirect_uri_mismatch`: o Google não aceita o callback HTTPS do Supabase |

O tipo do cliente **não pode ser alterado** depois de criado: se escolheu errado,
delete o cliente e crie outro (o projeto continua o mesmo).

### 2.3 Criar o cliente OAuth

1. Abra <https://console.cloud.google.com/auth/clients>
2. **Create client**
3. **Application type:** **Web application** — **não** "Desktop app" (ver abaixo)
4. **Name:** `MirrorMind Desktop`
5. Em **Authorized JavaScript origins**, adicione:
   ```
   https://uzxpeoxrvdcptvbepzua.supabase.co
   ```
6. Em **Authorized redirect URIs**, adicione **exatamente** esta linha:
   ```
   https://uzxpeoxrvdcptvbepzua.supabase.co/auth/v1/callback
   ```
7. **Create**
8. Copie o **Client ID** e o **Client secret** que aparecem na janela (o secret
   só é mostrado inteiro uma vez; se perder, gere outro).

✔️ **Deu certo se:** o redirect URI termina em `/auth/v1/callback` — sem barra
no fim, sem `www`, sem `http` no lugar de `https`.

---

## Etapa 3 — Colar as credenciais no Supabase (2 min)

1. Abra <https://supabase.com/dashboard/project/uzxpeoxrvdcptvbepzua/auth/providers>
2. Clique em **Google** e ligue o **Enable Sign In with Google**
3. Cole **Client ID** e **Client Secret** nos campos
4. **Save**

✔️ **Deu certo se:** o Google aparece com a etiqueta "Enabled".

---

## Etapa 4 — Dizer ao Supabase para onde voltar (3 min)

O app abre o navegador, a pessoa entra no Google e o navegador precisa devolver
o controle ao app. Esses são os endereços de volta.

1. Abra <https://supabase.com/dashboard/project/uzxpeoxrvdcptvbepzua/auth/url-configuration>
2. **Site URL:**
   ```
   http://127.0.0.1:5173
   ```
3. Em **Redirect URLs**, adicione as três linhas (uma por vez):
   ```
   http://127.0.0.1:*
   http://localhost:*
   mirrormind://auth
   ```
4. **Save**

Por que assim:

- `127.0.0.1:*` — no app instalado, o login usa uma portinha local temporária
  (o `*` cobre a porta que o sistema escolher). Esse é o caminho **principal**.
- `localhost:*` — o mesmo, para quando rodamos em modo de desenvolvimento.
- `mirrormind://auth` — o "link direto" que abre o app. Serve de conveniência:
  no Windows qualquer programa pode registrar um esquema, então ele não é o
  caminho principal de segurança.

---

## Etapa 5 — E-mail de confirmação (10 min, opcional no beta)

Por padrão o Supabase pede para confirmar o e-mail ao criar conta. O envio
padrão do Supabase é **limitado e não serve para produção** (poucos e-mails por
hora). Duas saídas:

**A. Beta rápido (hoje):** desligar a confirmação
<https://supabase.com/dashboard/project/uzxpeoxrvdcptvbepzua/auth/providers> →
**Email** → desligar **Confirm email** → Save.
Custo: conta criada com e-mail digitado errado entra assim mesmo. Aceitável com
poucos usuários, não aceitável ao abrir.

**B. Beta honesto (recomendado):** SMTP próprio
1. Crie conta em <https://resend.com> (3.000 e-mails/mês grátis), verifique um
   domínio — ou use o domínio de teste deles primeiro.
2. No Supabase: <https://supabase.com/dashboard/project/uzxpeoxrvdcptvbepzua/settings/auth>
   → **SMTP Settings** → **Enable custom SMTP**, com host/porta/usuário/senha do
   Resend.
3. Mantenha **Confirm email** ligado.

---

> **Decisão do beta (2026-11-19):** a confirmação de e-mail está **desligada**
> enquanto o beta for fechado (poucos usuários, todos conhecidos). Isso é uma
> dívida com prazo, não uma escolha permanente:
>
> - [ ] criar conta no Resend e verificar o domínio de envio;
> - [ ] configurar **SMTP próprio** no Supabase (Auth → SMTP Settings);
> - [ ] religar **Confirm email** (Auth → Providers → Email);
> - [ ] testar cadastro real recebendo o e-mail (caixa de entrada **e** spam);
> - [ ] trocar o remetente padrão (`noreply@`) pelo domínio próprio.
>
> Enquanto isso não acontece, **não abrir o cadastro ao público**: sem
> confirmação, um e-mail digitado errado cria uma conta que a pessoa não
> consegue recuperar. O item está no checklist bloqueante de lançamento
> (`docs/launch-roadmap.md`, M4).

## O que colocar no app (posso fazer por você)

Duas variáveis, no arquivo `.env` da raiz do projeto:

```dotenv
VITE_SUPABASE_URL=https://uzxpeoxrvdcptvbepzua.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

`.env` já está no `.gitignore` — nada disso vai para o repositório.

---

## Teste final (5 min)

1. Abra <https://supabase.com/dashboard/project/uzxpeoxrvdcptvbepzua/auth/users>
2. **Add user → Create new user**: um e-mail seu e uma senha.
3. Recarregue a lista: o usuário deve aparecer.
4. Abra o SQL Editor e rode:

```sql
select p.email, p.plan, p.plan_status, p.created_at
from public.profiles p
order by p.created_at desc
limit 5;
```

✔️ **Deu certo se:** cada usuário criado tem uma linha em `profiles` com
`plan = gratis`. Isso prova que o gatilho do banco está funcionando — não é o
app, é o banco criando o perfil sozinho.

Depois, apague esse usuário de teste (menu de três pontos na lista de usuários).

---

## Erros comuns (e o que significam)

| Mensagem / sintoma | Causa provável |
| --- | --- |
| `redirect_uri_mismatch` no Google | o redirect URI da Etapa 2.3 não é **idêntico** ao do Supabase (uma barra a mais basta) |
| `Unsupported provider: provider is not enabled` | Etapa 3 não foi salva, ou client ID/secret colados com espaço |
| Volta para `localhost` e não para o app | falta `mirrormind://auth` nas Redirect URLs (Etapa 4) |
| Login funciona, mas o app não vê o plano | normal: o app ainda não está lendo `profiles` (próxima etapa do código) |
| E-mail de confirmação nunca chega | SMTP padrão do Supabase com limite; ver Etapa 5 |

---

## Quando terminar

Me diga **"feito"**. Eu então:

1. coloco as duas variáveis no `.env`;
2. implemento o `SupabaseSessionClient` (login com e-mail+senha e Google, tokens
   só no keyring do Windows);
3. ligo a tela **Conta** que já existe, hoje atrás da flag desligada.
