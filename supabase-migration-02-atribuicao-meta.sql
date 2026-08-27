-- ==================================================================
-- MIGRAÇÃO 2 — Atribuição de vendas Trinks → Meta Ads
-- Cole isso no SQL Editor do Supabase e rode UMA vez (é seguro rodar
-- de novo se precisar, os comandos são idempotentes).
--
-- O que isso adiciona:
-- 1. Colunas pra guardar o "rastro" do clique do anúncio (fbclid/fbc/fbp)
--    no momento em que a pessoa resgata o cupom.
-- 2. Colunas pra guardar o resultado da venda quando ela fecha no Trinks.
-- 3. `resgatar_cupom` atualizada pra aceitar e salvar esse rastro.
--
-- A função `supabase/functions/trinks-webhook` (Edge Function) é quem
-- lê/escreve essas colunas depois, usando a service_role key — ela
-- roda no servidor, então não passa pelas regras de RLS/anon key.
-- ==================================================================

alter table cupons add column if not exists fbclid text;
alter table cupons add column if not exists fbc text;
alter table cupons add column if not exists fbp text;

alter table cupons add column if not exists venda_id_trinks text unique;
alter table cupons add column if not exists venda_valor numeric;
alter table cupons add column if not exists venda_data timestamptz;
alter table cupons add column if not exists venda_reportada_meta boolean not null default false;

-- precisa trocar a assinatura (3 parâmetros → 6), então recria a função
drop function if exists resgatar_cupom(text, text, text);

create or replace function resgatar_cupom(
  p_nome text, p_telefone text, p_email text,
  p_fbclid text default null, p_fbc text default null, p_fbp text default null
)
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
    -- se a pessoa voltar clicando num anúncio novo, atualiza o rastro
    -- (o último clique antes da venda é o que deve levar o crédito)
    if p_fbclid is not null or p_fbc is not null or p_fbp is not null then
      update cupons set
        fbclid = coalesce(p_fbclid, fbclid),
        fbc = coalesce(p_fbc, fbc),
        fbp = coalesce(p_fbp, fbp)
      where id = v_existente.id;
    end if;
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
  while exists(select 1 from cupons where codigo_cupom = v_codigo) loop
    v_codigo := 'FASTBAURU' || (1000 + floor(random() * 9000))::int;
  end loop;

  insert into cupons (nome, telefone, telefone_norm, email, email_norm, codigo_cupom, data_validade, fbclid, fbc, fbp)
  values (trim(p_nome), p_telefone, v_telefone_norm, p_email, v_email_norm, v_codigo, now() + interval '4 days', p_fbclid, p_fbc, p_fbp)
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

grant execute on function resgatar_cupom(text, text, text, text, text, text) to anon;
