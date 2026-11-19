-- Alinha `stripe_events` com o que o repositório descreve.
--
-- A tabela já existia (de uma versão anterior, com `processed_at`), então o
-- `create table if not exists` da 0006 **não criou nada** — e o repositório
-- passou a descrever uma coluna que não existia no banco. Renomear resolve para
-- os dois lados: num banco novo não há o que renomear (o `if` não casa), e neste
-- banco a coluna passa a ter o nome que o código e a documentação usam.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stripe_events'
      and column_name = 'processed_at'
  ) then
    alter table public.stripe_events rename column processed_at to received_at;
  end if;
end $$;

comment on column public.stripe_events.received_at is
  'Quando a função aplicou o evento. Não confundir com stripe_created (quando o Stripe gerou).';
