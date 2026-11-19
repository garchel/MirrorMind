-- Assinatura do add-on de nuvem controlada pelo Stripe.
--
-- O banco **não** decide plano: quem escreve `plan`, `plan_status`,
-- `plan_period_end` e `cloud_plan` é o webhook, com a service role. O app só lê
-- (e por isso continua local-first: sem webhook, nada muda e nada quebra).
--
-- `stripe_customer_id` guarda o cliente do Stripe de cada usuário; é por ele que
-- eventos de assinatura encontram a pessoa quando o `metadata` não vem.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;

-- Um cliente/subscription do Stripe pertence a um único perfil. Índice único
-- parcial porque quase todo mundo tem NULL aqui.
create unique index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists profiles_stripe_subscription_idx
  on public.profiles (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column public.profiles.stripe_customer_id is
  'Cliente no Stripe. Escrito apenas pelo webhook (service role).';
comment on column public.profiles.stripe_subscription_id is
  'Assinatura ativa no Stripe. Escrito apenas pelo webhook (service role).';

-- ---------------------------------------------------------------------------
-- Idempotência do webhook
-- ---------------------------------------------------------------------------
-- O Stripe reentrega eventos (timeout, 5xx, retry manual). Sem esta tabela, uma
-- reentrega de `invoice.payment_failed` rebaixaria alguém que já pagou — ou, pior,
-- uma reentrega fora de ordem venceria o evento mais novo.

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Eventos do Stripe já aplicados. A chave é o id do evento: reentrega não reprocessa.';

alter table public.stripe_events enable row level security;

-- Ninguém além da service role toca nisto: não é dado do usuário.
revoke all on public.stripe_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Leitura do próprio perfil (o app precisa saber se o add-on está ativo)
-- ---------------------------------------------------------------------------
-- A policy de select próprio já existe em 0001; esta função devolve só o que a
-- interface usa, para a tela não precisar de acesso amplo à tabela.
create or replace function public.my_entitlements()
returns table (
  plan text,
  plan_status text,
  plan_period_end timestamptz,
  cloud_plan text
)
language sql
security invoker
set search_path = public
as $$
  select p.plan, p.plan_status, p.plan_period_end, p.cloud_plan
  from public.profiles p
  where p.id = auth.uid()
$$;

comment on function public.my_entitlements() is
  'Direitos do usuário logado. `security invoker`: a RLS de profiles continua valendo.';

revoke all on function public.my_entitlements() from anon;
grant execute on function public.my_entitlements() to authenticated;
