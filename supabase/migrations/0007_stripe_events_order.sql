-- Correção de idempotência do webhook: ordem e reaplicação.
--
-- 1. `stripe_created` (unix segundos do evento no Stripe) e `subject` (para qual
--    objeto o evento fala — normalmente o id da assinatura) permitem recusar
--    evento **mais antigo** que um já aplicado. Dedupe por id não basta: uma
--    reentrega fora de ordem de `subscription.updated(active)` depois de
--    `subscription.deleted` devolveria acesso a quem cancelou.
--
-- 2. A função grava o evento, aplica os efeitos e, se os efeitos falharem,
--    **remove a linha do evento** para a reentrega do Stripe reprocessar. Antes
--    disso, a falha virava "duplicata" e o efeito se perdia.

alter table public.stripe_events
  add column if not exists stripe_created bigint,
  add column if not exists subject text;

comment on column public.stripe_events.stripe_created is
  'Event.created do Stripe (unix s). Usado para recusar evento mais antigo que um já aplicado.';
comment on column public.stripe_events.subject is
  'Objeto ao qual o evento se refere (id da assinatura, do cliente ou do usuário).';

create index if not exists stripe_events_subject_idx
  on public.stripe_events (subject, stripe_created desc);
