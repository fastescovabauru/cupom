-- ==================================================================
-- MIGRAÇÃO 3 — Reportar TODO cliente com visita finalizada pro Meta
-- (não só quem resgatou o cupom), sem duplicar em uploads repetidos.
-- Cole no SQL Editor do Supabase e rode uma vez.
-- ==================================================================

create table if not exists eventos_meta (
  id uuid primary key default gen_random_uuid(),
  chave_idempotencia text not null unique, -- telefone_norm|data (ou email|data se não tiver telefone)
  telefone_norm text,
  email_norm text,
  nome text,
  data_evento text,
  valor numeric,
  enviado boolean not null default false,
  criado_em timestamptz not null default now()
);

alter table eventos_meta enable row level security;
-- sem policy nenhuma — só a Edge Function (service_role) acessa essa tabela.
