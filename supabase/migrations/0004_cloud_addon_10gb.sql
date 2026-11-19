-- =============================================================================
-- MirrorMind — nuvem é add-on: 10 GB, independente do plano de IA
--
-- Por que mudar: a cota vinha de `plan` (gratis/essencial/pro), o que amarrava a
-- nuvem ao plano de IA. O produto decidido é o contrário — nuvem é add-on, então
-- quem usa Ollama ou a própria chave pode pagar só a nuvem, e quem paga o plano
-- de IA mais caro não ganha 10 GB de graça.
--
-- Nova regra: `cloud_plan` ('nenhum' | 'nuvem') decide a cota; `plan` continua
-- sendo só IA.
-- =============================================================================

alter table public.profiles
  add column if not exists cloud_plan text not null default 'nenhum'
    check (cloud_plan in ('nenhum', 'nuvem'));

comment on column public.profiles.cloud_plan is
  'Assinatura da nuvem (add-on), independente do plano de IA.';

-- a assinatura antiga derivava de `plan`; a função muda de nome no parâmetro,
-- então precisa ser recriada (Postgres não aceita renomear parâmetro)
drop function if exists public.cloud_quota_bytes(text);

create function public.cloud_quota_bytes(cloud_plan_id text)
returns bigint
language sql
immutable
set search_path = pg_catalog
as $$
  select case cloud_plan_id
    when 'nuvem' then 10::bigint * 1024 * 1024 * 1024
    else 0::bigint
  end
$$;

comment on function public.cloud_quota_bytes(text) is
  'Teto de nuvem do add-on: 10 GB com assinatura, 0 sem.';

create or replace function public.sync_cloud_quota()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.cloud_quota_bytes := public.cloud_quota_bytes(new.cloud_plan);
  return new;
end;
$$;

drop trigger if exists profiles_sync_cloud_quota on public.profiles;
create trigger profiles_sync_cloud_quota
  before insert or update of cloud_plan on public.profiles
  for each row execute function public.sync_cloud_quota();

update public.profiles
   set cloud_quota_bytes = public.cloud_quota_bytes(cloud_plan);

revoke execute on function public.cloud_quota_bytes(text) from public;
revoke execute on function public.sync_cloud_quota() from public;
