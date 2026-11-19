-- =============================================================================
-- MirrorMind — endurece as funções de trigger (advisors do Supabase)
--
-- Três achados reais do linter, dois deles introduzidos pela nuvem do vault:
--
-- 1. Funções SECURITY DEFINER em `public` são chamáveis pela API REST
--    (`/rest/v1/rpc/...`) pelos papéis `anon` e `authenticated`. Função de
--    trigger não precisa disso — quem chama é o Postgres. Revogar o EXECUTE
--    fecha uma porta que não deveria estar aberta.
-- 2. `search_path` mutável em função: com o caminho resolvido em tempo de
--    execução, um schema plantado antes no caminho pode sequestrar a chamada.
--    Fixar o caminho resolve.
--
-- `stripe_events` aparece com RLS e sem policy no linter, e isso é de propósito:
-- a tabela só é escrita pela Edge Function com service role. Não mexer.
-- =============================================================================

-- 1. ninguém de fora executa função de trigger
-- `PUBLIC` é o padrão do Postgres: revogar só de anon/authenticated não tira
-- nada, porque o grant herdado vem de PUBLIC. O advisor continuou acusando até
-- este revoke existir.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.sync_cloud_quota() from public;
revoke execute on function public.enforce_vault_quota() from public;
revoke execute on function public.touch_updated_at() from public;
revoke execute on function public.cloud_quota_bytes(text) from public;

-- 2. caminho de busca fixo
alter function public.touch_updated_at() set search_path = pg_catalog;
alter function public.cloud_quota_bytes(text) set search_path = pg_catalog;
alter function public.sync_cloud_quota() set search_path = public, pg_temp;
alter function public.enforce_vault_quota() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;

comment on function public.cloud_quota_bytes(text) is
  'Teto de nuvem por plano: gratis 0, essencial 2 GB, pro 10 GB.';
