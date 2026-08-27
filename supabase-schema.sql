-- ==================================================================
-- SCHEMA — Cupom de Hidratação · Fast Escova Bauru (Supabase)
-- Cole este arquivo inteiro no SQL Editor do Supabase (painel do
-- projeto → SQL Editor → New query → colar → Run) e rode uma vez só.
--
-- Depois de rodar, pegue em Settings → API:
--   - "Project URL"      → cole em SUPABASE_URL (index.html e admin.html)
--   - "anon public" key  → cole em SUPABASE_ANON_KEY (index.html e admin.html)
-- (as duas são seguras de expor no front-end — é assim que o Supabase
-- funciona; quem protege os dados são as regras RLS/funções abaixo,
-- não o segredo da chave.)
-- ==================================================================

-- tabela principal
create table if not exists cupons (
  id uuid primary key default gen_random_uuid(),
  data_cadastro timestamptz not null default now(),
  nome text not null,
  telefone text not null,
  telefone_norm text not null,
  email text not null,
  email_norm text not null,
  codigo_cupom text not null unique,
  data_validade timestamptz not null,
  compareceu boolean not null default false,
  compareceu_em timestamptz,
  email_enviado boolean not null default false
);

create index if not exists cupons_telefone_norm_idx on cupons (telefone_norm);
create index if not exists cupons_email_norm_idx on cupons (email_norm);

-- ninguém acessa a tabela direto pela API (nem leitura, nem escrita) —
-- só as funções abaixo (SECURITY DEFINER) conseguem tocar nela.
alter table cupons enable row level security;

-- tabela de config (guarda a senha do admin.html) — também sem policy
-- nenhuma, só a função valida_admin_ enxerga.
create table if not exists config_admin (
  id int primary key default 1,
  senha text not null,
  check (id = 1)
);
alter table config_admin enable row level security;

-- rode isto UMA vez, trocando 'TROQUE_ESSA_SENHA' pela senha real que
-- a equipe da loja vai digitar em admin.html:
insert into config_admin (id, senha) values (1, 'TROQUE_ESSA_SENHA')
on conflict (id) do update set senha = excluded.senha;

-- ---------- FUNÇÕES ----------

create or replace function valida_admin_(p_senha text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from config_admin where senha = p_senha);
$$;

-- Resgata (ou reconsulta) o cupom de uma pessoa. Chamado direto pelo
-- index.html com a anon key — por isso todo o cuidado de duplicidade
-- e cálculo de validade fica aqui dentro, não no front-end.
create or replace function resgatar_cupom(p_nome text, p_telefone text, p_email text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telefone_norm text := regexp_replace(coalesce(p_telefone,''), '\D', '', 'g');
  v_email_norm text := lower(trim(coalesce(p_email,'')));
  v_existente cupons%rowtype;
  v_novo cupons%rowtype;
  v_codigo text;
begin
  if p_nome is null or trim(p_nome) = '' or length(v_telefone_norm) < 10 or v_email_norm = '' then
    return json_build_object('ok', false, 'erro', 'dados incompletos');
  end if;

  select * into v_existente from cupons
    where telefone_norm = v_telefone_norm or email_norm = v_email_norm
    limit 1;

  if found then
    return json_build_object(
      'ok', true, 'existente', true,
      'cupom', json_build_object(
        'nome', v_existente.nome,
        'codigo_cupom', v_existente.codigo_cupom,
        'data_cadastro', to_char(v_existente.data_cadastro at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
        'data_validade', to_char(v_existente.data_validade at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
        'status', case
          when v_existente.compareceu then 'usado'
          when v_existente.data_validade < now() then 'expirado'
          else 'valido'
        end
      )
    );
  end if;

  v_codigo := 'FASTBAURU' || (1000 + floor(random() * 9000))::int;
  -- garante código único mesmo no raríssimo caso de colisão
  while exists(select 1 from cupons where codigo_cupom = v_codigo) loop
    v_codigo := 'FASTBAURU' || (1000 + floor(random() * 9000))::int;
  end loop;

  insert into cupons (nome, telefone, telefone_norm, email, email_norm, codigo_cupom, data_validade)
  values (trim(p_nome), p_telefone, v_telefone_norm, p_email, v_email_norm, v_codigo, now() + interval '4 days')
  returning * into v_novo;

  return json_build_object(
    'ok', true, 'existente', false,
    'cupom', json_build_object(
      'nome', v_novo.nome,
      'codigo_cupom', v_novo.codigo_cupom,
      'data_cadastro', to_char(v_novo.data_cadastro at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
      'data_validade', to_char(v_novo.data_validade at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
      'status', 'valido'
    )
  );
end;
$$;

-- Marca que o email do cupom foi enviado com sucesso (chamado pelo
-- index.html logo depois do Apps Script confirmar o envio).
create or replace function marcar_email_enviado(p_codigo text)
returns void
language sql
security definer
set search_path = public
as $$
  update cupons set email_enviado = true where codigo_cupom = p_codigo;
$$;

-- Painel admin: lista tudo (protegido por senha, checada aqui dentro).
create or replace function listar_admin(p_senha text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not valida_admin_(p_senha) then
    return json_build_object('erro', 'senha inválida');
  end if;
  return (
    select json_agg(json_build_object(
      'codigo_cupom', codigo_cupom,
      'nome', nome,
      'telefone', telefone,
      'data_cadastro', to_char(data_cadastro at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
      'data_validade', to_char(data_validade at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
      'compareceu', compareceu,
      'compareceu_em', to_char(compareceu_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
    ))
    from cupons
  );
end;
$$;

-- Painel admin: dá baixa (marca como usado presencialmente).
create or replace function marcar_compareceu(p_codigo text, p_senha text)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not valida_admin_(p_senha) then
    return json_build_object('ok', false, 'erro', 'senha inválida');
  end if;
  update cupons set compareceu = true, compareceu_em = now()
    where codigo_cupom = p_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'cupom não encontrado');
  end if;
  return json_build_object('ok', true);
end;
$$;

-- libera a execução das funções pra chave anon (a tabela em si continua
-- travada pelo RLS acima — só dá pra passar pelas funções mesmo).
grant execute on function resgatar_cupom(text, text, text) to anon;
grant execute on function marcar_email_enviado(text) to anon;
grant execute on function listar_admin(text) to anon;
grant execute on function marcar_compareceu(text, text) to anon;
