-- O nome do vault é rótulo, não identidade.
--
-- Duas pastas podem se chamar "Estudo" (em discos ou computadores diferentes), e
-- o app já permite isso localmente. A unicidade por `(owner_id, name)` fazia o
-- segundo registro falhar com 409 "duplicate key" — e com uma mensagem que não
-- sugeria nada ao usuário.
--
-- A identidade é `(owner_id, local_id)`: o `local_id` nasce no vault e viaja com
-- a pasta, então o mesmo vault em outro computador cai no mesmo registro.

alter table public.vaults drop constraint if exists vaults_owner_id_name_key;

comment on column public.vaults.name is
  'Rotulo exibido. Nao e unico: duas pastas podem ter o mesmo nome.';
