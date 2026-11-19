-- =============================================================================
-- MirrorMind — contas, planos e consumo (F1b)
--
-- Princípio: o servidor guarda QUEM PAGA e QUANTO USOU, nunca o conteúdo das
-- notas. Não existe tabela de notas aqui — a nuvem do Pro, quando existir,
-- entra em migration própria com blob cifrado no cliente.
--
-- Aplicar com: supabase db push   (ou colar no SQL Editor do projeto)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. perfil: 1 linha por usuário de auth.users
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  plan text not null default 'gratis'
    check (plan in ('gratis', 'essencial', 'pro')),
  plan_status text not null default 'active'
    check (plan_status in ('active', 'past_due', 'canceled')),
  -- fim do ciclo pago; null no grátis
  plan_period_end timestamptz,
  -- consentimentos (LGPD Art. 8): datas, nunca booleano solto
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Quem é o usuário, qual plano tem e até quando. Plano é escrito apenas pelo webhook do Stripe.';

-- o perfil nasce junto com o usuário, para o app nunca lidar com "usuário sem perfil"
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, terms_accepted_at, privacy_accepted_at)
  values (
    new.id,
    coalesce(new.email, ''),
    -- metadados aceitos no cadastro (o app envia; ausente = null, não mentira)
    (new.raw_user_meta_data ->> 'terms_accepted_at')::timestamptz,
    (new.raw_user_meta_data ->> 'privacy_accepted_at')::timestamptz
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- 2. assinaturas: espelho do Stripe (a fonte da verdade continua sendo a Stripe)
-- -----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  -- status do Stripe: active, trialing, past_due, canceled, incomplete, unpaid...
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);
create index if not exists subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

comment on table public.subscriptions is
  'Espelho do estado da assinatura na Stripe. Nunca é fonte de verdade: o webhook reconsulta o objeto antes de gravar.';

-- -----------------------------------------------------------------------------
-- 3. consumo de IA gerenciada: o livro-caixa do uso justo
-- -----------------------------------------------------------------------------
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  provider text not null,
  model text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(12, 6),
  -- chave do cliente: retry de rede não vira segunda chamada cobrada
  idempotency_key text not null unique,
  -- 'reserved' antes da chamada, 'confirmed' depois; 'failed' quando o provedor negou
  state text not null default 'reserved'
    check (state in ('reserved', 'confirmed', 'failed'))
);

create index if not exists ai_usage_user_day_idx
  on public.ai_usage (user_id, ((occurred_at at time zone 'America/Sao_Paulo')::date));
create index if not exists ai_usage_user_month_idx
  on public.ai_usage (user_id, date_trunc('month', occurred_at at time zone 'America/Sao_Paulo'));

comment on table public.ai_usage is
  'Cada chamada gerenciada, com custo e idempotência. Escrito só pela Edge Function (service_role).';

-- -----------------------------------------------------------------------------
-- 4. eventos do Stripe: idempotência do webhook
-- -----------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id text primary key,          -- evt_...
  type text not null,
  processed_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Webhook duplicado é o comportamento normal da Stripe: o event.id como PK é o que evita efeito dobrado.';

-- -----------------------------------------------------------------------------
-- 5. dispositivos (opcional): "sair de todos os aparelhos" e diagnóstico
-- -----------------------------------------------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text,
  platform text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists devices_user_idx on public.devices (user_id);

-- -----------------------------------------------------------------------------
-- 6. updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- 7. RLS — o padrão é negar
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.stripe_events enable row level security;
alter table public.devices enable row level security;

-- profiles: o usuário vê e edita o próprio perfil; colunas comerciais são do webhook
drop policy if exists "profiles: ler o próprio" on public.profiles;
create policy "profiles: ler o próprio"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles: editar o próprio" on public.profiles;
create policy "profiles: editar o próprio"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Plano, status e datas não são editáveis pelo cliente, mesmo com o update
-- liberado: privilégio de coluna é a trava (RLS não distingue coluna).
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- assinaturas: leitura do próprio; escrita só pelo service_role
drop policy if exists "subscriptions: ler a própria" on public.subscriptions;
create policy "subscriptions: ler a própria"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

-- consumo: leitura do próprio; escrita só pelo service_role
drop policy if exists "ai_usage: ler o próprio" on public.ai_usage;
create policy "ai_usage: ler o próprio"
  on public.ai_usage for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.ai_usage from authenticated;

-- dispositivos: o usuário gerencia os próprios
drop policy if exists "devices: ler os próprios" on public.devices;
create policy "devices: ler os próprios"
  on public.devices for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "devices: escrever os próprios" on public.devices;
create policy "devices: escrever os próprios"
  on public.devices for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "devices: remover os próprios" on public.devices;
create policy "devices: remover os próprios"
  on public.devices for delete
  to authenticated
  using (auth.uid() = user_id);

-- stripe_events: nenhuma policy para `authenticated` = nenhum acesso.
-- `service_role` ignora RLS por definição.

-- =============================================================================
-- 8. resumo de consumo (para a UI "Meu uso" sem varrer o ledger)
-- =============================================================================
create or replace view public.ai_usage_summary
with (security_invoker = true) as
select
  user_id,
  (now() at time zone 'America/Sao_Paulo')::date as today,
  count(*) filter (where (occurred_at at time zone 'America/Sao_Paulo')::date
    = (now() at time zone 'America/Sao_Paulo')::date) as calls_today,
  count(*) filter (where date_trunc('month', occurred_at at time zone 'America/Sao_Paulo')
    = date_trunc('month', now() at time zone 'America/Sao_Paulo')) as calls_this_month,
  coalesce(sum(cost_usd) filter (where date_trunc('month', occurred_at at time zone 'America/Sao_Paulo')
    = date_trunc('month', now() at time zone 'America/Sao_Paulo')), 0) as cost_this_month_usd
from public.ai_usage
where state <> 'failed'
group by user_id;

comment on view public.ai_usage_summary is
  'Agregado por usuário; security_invoker garante que a RLS de ai_usage continue valendo.';
