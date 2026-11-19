-- =============================================================================
-- MirrorMind — nuvem do vault (fase 2, decisão A)
--
-- Decisão de produto (2026-11-19): **uma pessoa por conta, cada usuário com o
-- seu vault**. O app é de estudo individual, então não existe compartilhamento
-- de vault entre contas — e isso é o que mantém o histórico de revisão no
-- formato de hoje (resumo FSRS), sem precisar de diário de eventos.
--
-- O que sobe: conteúdo das notas e anexos do vault, por dono. O servidor passa a
-- ver o conteúdo — antes não via. Está declarado na política de privacidade.
--
-- Cotas (1 linha por plano, em `cloud_quota_bytes`):
--   gratis     0 GB  (nuvem não incluída; o app continua 100% local)
--   essencial  2 GB
--   pro       10 GB
-- Custo no Pro do Supabase: US$ 0,0213 por GB/mês acima dos 100 GB incluídos —
-- 10 GB por usuário custa ~US$ 0,21/mês, o que cabe folgado num add-on pago.
--
-- Aplicar com: supabase db push   (ou colar no SQL Editor do projeto)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. cotas por plano
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists cloud_quota_bytes bigint not null default 0;

comment on column public.profiles.cloud_quota_bytes is
  'Teto de armazenamento na nuvem para o plano atual. 0 = nuvem não incluída.';

create or replace function public.cloud_quota_bytes(plan_id text)
returns bigint
language sql
immutable
as $$
  select case plan_id
    when 'pro' then 10::bigint * 1024 * 1024 * 1024
    when 'essencial' then 2::bigint * 1024 * 1024 * 1024
    else 0::bigint
  end
$$;

-- mantém a cota coerente quando o webhook do Stripe troca o plano
create or replace function public.sync_cloud_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.cloud_quota_bytes := public.cloud_quota_bytes(new.plan);
  return new;
end;
$$;

drop trigger if exists profiles_sync_cloud_quota on public.profiles;
create trigger profiles_sync_cloud_quota
  before insert or update of plan on public.profiles
  for each row execute function public.sync_cloud_quota();

-- cota das contas que já existem
update public.profiles
   set cloud_quota_bytes = public.cloud_quota_bytes(plan);

-- -----------------------------------------------------------------------------
-- 2. vaults: um por pasta sincronizada, sempre de um único dono
-- -----------------------------------------------------------------------------
create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  -- identificador que o app grava em `.mirmind/cloud.json` para reconhecer o
  -- mesmo vault em outra máquina do mesmo dono
  local_id text not null check (char_length(local_id) between 8 and 64),
  created_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (owner_id, local_id),
  unique (owner_id, name)
);

comment on table public.vaults is
  'Pasta sincronizada de um usuário. Não há compartilhamento: owner_id é o único acesso (decisão A).';

create index if not exists vaults_owner_idx on public.vaults (owner_id);

-- -----------------------------------------------------------------------------
-- 3. arquivos do vault: notas e anexos, com hash para decidir o que subir
-- -----------------------------------------------------------------------------
create table if not exists public.vault_files (
  vault_id uuid not null references public.vaults (id) on delete cascade,
  -- caminho relativo normalizado (mesma forma usada pelo app, com "/")
  path text not null check (char_length(path) between 1 and 1024),
  kind text not null check (kind in ('note', 'attachment')),
  -- sha256 do conteúdo: é o que evita subir de novo o que não mudou
  content_hash text not null check (char_length(content_hash) = 64),
  size_bytes bigint not null check (size_bytes >= 0),
  -- objeto no bucket `vault-files` (<owner>/<vault>/<caminho>)
  storage_path text,
  -- exclusão é marca, não linha apagada: sem isso o outro lado "ressuscita"
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (vault_id, path)
);

create index if not exists vault_files_updated_idx
  on public.vault_files (vault_id, updated_at desc);

comment on table public.vault_files is
  'Metadados por arquivo do vault. O conteúdo fica no Storage; aqui vive o hash que decide o que sincronizar.';

drop trigger if exists vault_files_touch_updated_at on public.vault_files;
create trigger vault_files_touch_updated_at
  before update on public.vault_files
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 4. cota: o banco recusa o que passa do plano, não só a interface
-- -----------------------------------------------------------------------------
create or replace function public.enforce_vault_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dono uuid;
  cota bigint;
  usado bigint;
begin
  select v.owner_id, p.cloud_quota_bytes
    into dono, cota
    from public.vaults v
    join public.profiles p on p.id = v.owner_id
   where v.id = new.vault_id;

  if dono is null then
    raise exception 'vault inexistente' using errcode = 'foreign_key_violation';
  end if;

  if cota = 0 then
    raise exception 'o plano atual nao inclui nuvem' using errcode = 'insufficient_privilege';
  end if;

  -- Soma tudo do dono (todos os vaults dele) menos a própria linha, que está
  -- sendo inserida ou reescrita agora. Arquivo marcado como excluído não ocupa
  -- cota: o conteúdo já saiu do Storage.
  select coalesce(sum(f.size_bytes), 0)
    into usado
    from public.vault_files f
   where f.vault_id in (select id from public.vaults where owner_id = dono)
     and f.deleted_at is null
     and not (f.vault_id = new.vault_id and f.path = new.path);

  if usado + new.size_bytes > cota then
    raise exception 'cota de armazenamento excedida'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists vault_files_enforce_quota on public.vault_files;
create trigger vault_files_enforce_quota
  before insert or update of size_bytes on public.vault_files
  for each row execute function public.enforce_vault_quota();

-- -----------------------------------------------------------------------------
-- 5. uso por usuário (para a barra de "Meu uso" e para o suporte)
-- -----------------------------------------------------------------------------
create or replace view public.vault_usage
with (security_invoker = true)
as
select
  v.owner_id,
  v.id as vault_id,
  coalesce(sum(f.size_bytes) filter (where f.deleted_at is null), 0)::bigint as used_bytes,
  count(f.path) filter (where f.deleted_at is null) as file_count
from public.vaults v
left join public.vault_files f on f.vault_id = v.id
group by v.owner_id, v.id;

comment on view public.vault_usage is
  'Quanto cada vault ocupa. security_invoker: a RLS das tabelas continua valendo para quem consulta.';

-- -----------------------------------------------------------------------------
-- 6. RLS: só o dono, sempre
-- -----------------------------------------------------------------------------
alter table public.vaults enable row level security;
alter table public.vault_files enable row level security;

drop policy if exists "vaults: ler o próprio" on public.vaults;
create policy "vaults: ler o próprio"
  on public.vaults for select
  using (auth.uid() = owner_id);

drop policy if exists "vaults: criar o próprio" on public.vaults;
create policy "vaults: criar o próprio"
  on public.vaults for insert
  with check (auth.uid() = owner_id);

drop policy if exists "vaults: editar o próprio" on public.vaults;
create policy "vaults: editar o próprio"
  on public.vaults for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "vaults: excluir o próprio" on public.vaults;
create policy "vaults: excluir o próprio"
  on public.vaults for delete
  using (auth.uid() = owner_id);

drop policy if exists "vault_files: ler os do próprio vault" on public.vault_files;
create policy "vault_files: ler os do próprio vault"
  on public.vault_files for select
  using (
    exists (
      select 1 from public.vaults v
      where v.id = vault_files.vault_id and v.owner_id = auth.uid()
    )
  );

drop policy if exists "vault_files: escrever nos do próprio vault" on public.vault_files;
create policy "vault_files: escrever nos do próprio vault"
  on public.vault_files for insert
  with check (
    exists (
      select 1 from public.vaults v
      where v.id = vault_files.vault_id and v.owner_id = auth.uid()
    )
  );

drop policy if exists "vault_files: atualizar os do próprio vault" on public.vault_files;
create policy "vault_files: atualizar os do próprio vault"
  on public.vault_files for update
  using (
    exists (
      select 1 from public.vaults v
      where v.id = vault_files.vault_id and v.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.vaults v
      where v.id = vault_files.vault_id and v.owner_id = auth.uid()
    )
  );

drop policy if exists "vault_files: excluir os do próprio vault" on public.vault_files;
create policy "vault_files: excluir os do próprio vault"
  on public.vault_files for delete
  using (
    exists (
      select 1 from public.vaults v
      where v.id = vault_files.vault_id and v.owner_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 7. bucket de conteúdo: privado, caminho sempre começa pelo id do dono
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('vault-files', 'vault-files', false, 26214400) -- 25 MB por arquivo
on conflict (id) do nothing;

drop policy if exists "vault-files: ler o próprio" on storage.objects;
create policy "vault-files: ler o próprio"
  on storage.objects for select
  using (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vault-files: enviar o próprio" on storage.objects;
create policy "vault-files: enviar o próprio"
  on storage.objects for insert
  with check (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vault-files: atualizar o próprio" on storage.objects;
create policy "vault-files: atualizar o próprio"
  on storage.objects for update
  using (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vault-files: apagar o próprio" on storage.objects;
create policy "vault-files: apagar o próprio"
  on storage.objects for delete
  using (
    bucket_id = 'vault-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
