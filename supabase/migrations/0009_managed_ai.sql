-- =============================================================================
-- MirrorMind — IA gerenciada pela assinatura (F3)
--
-- A chave do provedor fica no servidor (secret da função de borda), nunca no
-- cliente. Quem decide se a chamada acontece é o banco, com os tetos da decisão
-- de pacotes do beta (docs/monetization-beta-decision.md):
--
--   grátis     50 chamadas únicas (não renováveis), 20/dia, 10/minuto
--   essencial  1.000/mês (uso justo), 300/dia, 20/minuto, teto US$ 4/mês
--   pro        1.200/mês (uso justo), 400/dia, 30/minuto, teto US$ 5/mês
--
-- O ledger é `ai_usage` (já existia): reserva antes do custo, confirma depois.
-- Reserva antes porque duas chamadas simultâneas não podem passar juntas pelo
-- mesmo saldo — o mesmo motivo pelo qual o app reserva no `usage.rs` local.
--
-- Aplicar com: supabase db push
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. catálogo de planos: `ia_mensal`/`ia_anual` eram placeholders do catálogo de
--    código; a decisão de pacotes usa `essencial`/`pro`. Migra o que existir.
-- -----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_plan_check;

update public.profiles set plan = 'essencial' where plan = 'ia_mensal';
update public.profiles set plan = 'pro' where plan = 'ia_anual';

alter table public.profiles
  add constraint profiles_plan_check check (plan in ('gratis', 'essencial', 'pro'));

comment on column public.profiles.plan is
  'Plano de IA: gratis | essencial | pro. Escrito pelo webhook do Stripe (service role).';

-- -----------------------------------------------------------------------------
-- 2. tetos por plano, num lugar só (o app não repete números)
-- -----------------------------------------------------------------------------
create or replace function public.ai_limits(plan_id text)
returns jsonb
language sql
immutable
as $$
  select case plan_id
    when 'essencial' then jsonb_build_object(
      'lifetime', null, 'monthly', 1000, 'daily', 300, 'perMinute', 20,
      'costUsdMonthly', 4
    )
    when 'pro' then jsonb_build_object(
      'lifetime', null, 'monthly', 1200, 'daily', 400, 'perMinute', 30,
      'costUsdMonthly', 5
    )
    else jsonb_build_object(
      'lifetime', 50, 'monthly', null, 'daily', 20, 'perMinute', 10,
      'costUsdMonthly', null
    )
  end
$$;

comment on function public.ai_limits(text) is
  'Tetos de IA gerenciada por plano. null = sem teto daquele tipo.';

-- contagem por janela, uma expressão só para não divergir entre funções
create or replace function public.ai_calls_between(p_user uuid, p_from timestamptz)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.ai_usage
  where user_id = p_user
    and state <> 'failed'
    and occurred_at >= p_from
$$;

create index if not exists ai_usage_user_time_idx
  on public.ai_usage (user_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- 3. status (o app mostra "quantas restam" só quando interessa)
-- -----------------------------------------------------------------------------
create or replace function public.managed_ai_status(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plano text;
  limites jsonb;
  total bigint;
  mes bigint;
  dia bigint;
  custo_mes numeric;
begin
  select plan into plano from public.profiles where id = p_user;
  if plano is null then
    return jsonb_build_object('plan', null, 'allowed', false, 'reason', 'sem_perfil');
  end if;
  limites := public.ai_limits(plano);

  total := public.ai_calls_between(p_user, '-infinity'::timestamptz);
  mes := public.ai_calls_between(p_user, date_trunc('month', now()));
  dia := public.ai_calls_between(p_user, date_trunc('day', now()));

  select coalesce(sum(cost_usd), 0) into custo_mes
  from public.ai_usage
  where user_id = p_user
    and state <> 'failed'
    and occurred_at >= date_trunc('month', now());

  return jsonb_build_object(
    'plan', plano,
    'limits', limites,
    'used', jsonb_build_object(
      'lifetime', total, 'month', mes, 'day', dia, 'costUsdMonth', custo_mes
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. reserva atômica
--    `p_idempotency` é a chave que o app manda; repetir a mesma chave devolve a
--    mesma reserva (retry de rede não cobra duas vezes).
-- -----------------------------------------------------------------------------
create or replace function public.reserve_managed_ai(
  p_user uuid,
  p_idempotency text,
  p_provider text,
  p_model text,
  p_estimated_cost numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plano text;
  status_plano text;
  limites jsonb;
  ja_existe public.ai_usage%rowtype;
  vivo bigint;
  mes bigint;
  dia bigint;
  ultimo_minuto bigint;
  custo_mes numeric;
  novo_id uuid;
  teto_custo numeric;
begin
  select * into ja_existe
  from public.ai_usage
  where idempotency_key = p_idempotency and user_id = p_user;

  -- Reaproveita só reserva **viva**: devolver a mesma reserva de uma tentativa
  -- que falhou daria chamada grátis no retry (o provedor cobra, a cota não).
  if ja_existe.id is not null and ja_existe.state <> 'failed' then
    return jsonb_build_object('allowed', true, 'callId', ja_existe.id, 'reused', true);
  end if;

  select plan, plan_status into plano, status_plano
  from public.profiles where id = p_user;

  if plano is null then
    return jsonb_build_object('allowed', false, 'reason', 'sem_perfil');
  end if;
  if status_plano is not null and status_plano not in ('active', 'past_due') then
    return jsonb_build_object('allowed', false, 'reason', 'assinatura_inativa');
  end if;

  limites := public.ai_limits(plano);
  vivo := public.ai_calls_between(p_user, '-infinity'::timestamptz);
  mes := public.ai_calls_between(p_user, date_trunc('month', now()));
  dia := public.ai_calls_between(p_user, date_trunc('day', now()));
  ultimo_minuto := public.ai_calls_between(p_user, now() - interval '1 minute');

  if (limites->>'lifetime') is not null and vivo >= (limites->>'lifetime')::bigint then
    return jsonb_build_object(
      'allowed', false, 'reason', 'cota_vitalicia',
      'limit', (limites->>'lifetime')::bigint, 'used', vivo
    );
  end if;

  if (limites->>'monthly') is not null and mes >= (limites->>'monthly')::bigint then
    return jsonb_build_object(
      'allowed', false, 'reason', 'cota_mensal',
      'limit', (limites->>'monthly')::bigint, 'used', mes
    );
  end if;

  if (limites->>'daily') is not null and dia >= (limites->>'daily')::bigint then
    return jsonb_build_object(
      'allowed', false, 'reason', 'cota_diaria',
      'limit', (limites->>'daily')::bigint, 'used', dia
    );
  end if;

  if (limites->>'perMinute') is not null and ultimo_minuto >= (limites->>'perMinute')::bigint then
    return jsonb_build_object(
      'allowed', false, 'reason', 'cota_minuto',
      'limit', (limites->>'perMinute')::bigint, 'used', ultimo_minuto
    );
  end if;

  teto_custo := nullif(limites->>'costUsdMonthly', '')::numeric;
  if teto_custo is not null then
    select coalesce(sum(cost_usd), 0) into custo_mes
    from public.ai_usage
    where user_id = p_user
      and state <> 'failed'
      and occurred_at >= date_trunc('month', now());
    if custo_mes + coalesce(p_estimated_cost, 0) > teto_custo then
      return jsonb_build_object(
        'allowed', false, 'reason', 'teto_custo',
        'limit', teto_custo, 'used', custo_mes
      );
    end if;
  end if;

  if ja_existe.id is not null then
    -- Retry de uma tentativa que falhou: a mesma linha volta a valer, para a
    -- chamada contar uma vez só.
    update public.ai_usage
       set state = 'reserved',
           cost_usd = coalesce(p_estimated_cost, 0),
           tokens_in = null,
           tokens_out = null
     where id = ja_existe.id
    returning id into novo_id;
  else
    insert into public.ai_usage (
      user_id, provider, model, cost_usd, idempotency_key, state
    ) values (
      p_user, p_provider, p_model, coalesce(p_estimated_cost, 0), p_idempotency, 'reserved'
    )
    returning id into novo_id;
  end if;

  return jsonb_build_object('allowed', true, 'callId', novo_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. confirmação (depois do custo) e falha
-- -----------------------------------------------------------------------------
create or replace function public.confirm_managed_ai(
  p_call uuid,
  p_tokens_in int,
  p_tokens_out int,
  p_cost_usd numeric
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage
  set state = 'confirmed',
      tokens_in = p_tokens_in,
      tokens_out = p_tokens_out,
      cost_usd = coalesce(p_cost_usd, cost_usd)
  where id = p_call
$$;

create or replace function public.fail_managed_ai(p_call uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage set state = 'failed' where id = p_call
$$;

-- -----------------------------------------------------------------------------
-- 6. ninguém além da service role (a função de borda) executa isto: os tetos não
--    podem ser chamados pelo cliente, senão viram sugestão.
-- -----------------------------------------------------------------------------
revoke all on function public.ai_limits(text) from public, anon, authenticated;
revoke all on function public.ai_calls_between(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.managed_ai_status(uuid) from public, anon, authenticated;
revoke all on function public.reserve_managed_ai(uuid, text, text, text, numeric) from public, anon, authenticated;
revoke all on function public.confirm_managed_ai(uuid, int, int, numeric) from public, anon, authenticated;
revoke all on function public.fail_managed_ai(uuid) from public, anon, authenticated;

-- O dono lê o próprio ledger (transparência), nunca escreve.
drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage
  for select to authenticated
  using (user_id = auth.uid());
