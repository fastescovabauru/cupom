// ==================================================================
// EDGE FUNCTION — Importação manual de vendas (período de 30 dias
// enquanto a API paga da Trinks não é contratada).
//
// Recebe uma lista de vendas exportada da Trinks (colada/enviada pela
// Luana 2x por semana via `importar-vendas.html`), casa cada uma com
// um lead da tabela `cupons` e reporta pro Meta Conversions API —
// mesma lógica do `trinks-webhook.ts`, só que disparada manualmente
// em vez de em tempo real por webhook.
//
// COMO INSTALAR (mesmo processo do trinks-webhook.ts):
// 1. Supabase → Edge Functions → Deploy a new function.
// 2. Nome da função: importar-vendas-manual
// 3. Cole este arquivo inteiro e faça o deploy.
// 4. Secrets necessários (Edge Functions → importar-vendas-manual → Secrets):
//      META_ACCESS_TOKEN = token do Meta com permissão ads_management
//      (mesmo token usado no trinks-webhook.ts — se já configurou lá,
//      configure aqui também, são secrets por função).
// 5. Copie a URL da função e cole em `IMPORTAR_VENDAS_URL` dentro de
//    `importar-vendas.html`.
//
// Quando a API paga da Trinks for contratada e o `trinks-webhook.ts`
// entrar no ar, essa função pode ficar desativada (não tem problema
// deixar publicada sem uso, ou apagar se preferir organização).
// ==================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
const META_PIXEL_ID = "2253088758874211";
const META_API_VERSION = "v20.0";
const EVENT_SOURCE_URL = "https://fastescovabauru.github.io/cupom/";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface VendaEntrada {
  nome?: string;
  telefone?: string;
  email?: string;
  valor?: string | number;
  data?: string; // qualquer formato reconhecível (DD/MM/YYYY, YYYY-MM-DD, etc.)
}

interface ResultadoLinha {
  linha: number;
  status: "enviado" | "ja_processado" | "sem_lead" | "dados_invalidos" | "erro_meta";
  codigo_cupom?: string;
  detalhe?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: { senha?: string; vendas?: VendaEntrada[] };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, erro: "payload inválido" }, 400);
  }

  const senhaValida = await validarSenha(body.senha || "");
  if (!senhaValida) {
    return json({ ok: false, erro: "senha inválida" }, 403);
  }

  const vendas = Array.isArray(body.vendas) ? body.vendas : [];
  if (vendas.length === 0) {
    return json({ ok: false, erro: "nenhuma venda enviada" }, 400);
  }
  if (vendas.length > 500) {
    return json({ ok: false, erro: "muitas linhas de uma vez (máximo 500)" }, 400);
  }

  const resultados: ResultadoLinha[] = [];
  for (let i = 0; i < vendas.length; i++) {
    resultados.push(await processarLinha(vendas[i], i + 1));
  }

  return json({ ok: true, resultados });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function validarSenha(senha: string): Promise<boolean> {
  if (!senha) return false;
  const { data } = await sb.from("config_admin").select("senha").eq("id", 1).maybeSingle();
  return !!data && data.senha === senha;
}

/* ---------- PROCESSAMENTO DE CADA LINHA ----------
   Manda pro Meta TODO cliente com visita/venda (não só quem resgatou
   o cupom da hidratação) — vocês rodam mais de uma campanha, e a
   atribuição de qualquer uma delas depende desse sinal de conversão.
   Quando bate com um cupom nosso, aproveita o fbc/fbp salvo lá pra
   melhorar a atribuição; quando não bate, manda mesmo assim só com
   telefone/email (o Meta ainda usa isso pra achar quem se parece com
   quem comprou). */

async function processarLinha(venda: VendaEntrada, linha: number): Promise<ResultadoLinha> {
  const telefoneNorm = String(venda.telefone || "").replace(/\D/g, "");
  const email = String(venda.email || "").trim().toLowerCase();
  const valor = parseValorBr(venda.valor); // pode ser null — relatório de Clientes não traz valor
  const dataFechamento = parseDataFlexivel(venda.data);

  if (telefoneNorm.length < 10 && !email) {
    return { linha, status: "dados_invalidos", detalhe: "sem telefone nem email pra identificar o cliente" };
  }

  // idempotência genérica (funciona com ou sem cupom): mesma pessoa +
  // mesma data de evento não gera dois eventos, mesmo subindo a
  // planilha de novo com gente repetida.
  const chave = `${telefoneNorm || email}|${dataFechamento || "sem-data"}`;
  const { data: jaExiste } = await sb.from("eventos_meta").select("enviado").eq("chave_idempotencia", chave).maybeSingle();
  if (jaExiste?.enviado) {
    return { linha, status: "ja_processado" };
  }

  // tenta casar com um cupom nosso (enriquece com fbc/fbp do clique do anúncio)
  let registro: Record<string, any> | null = null;
  if (telefoneNorm.length >= 10) {
    const { data } = await sb.from("cupons").select("*").eq("telefone_norm", telefoneNorm).maybeSingle();
    if (data) registro = data;
  }
  if (!registro && email) {
    const { data } = await sb.from("cupons").select("*").eq("email_norm", email).maybeSingle();
    if (data) registro = data;
  }

  let enviado = false;
  let detalheErro: string | undefined;
  if (META_ACCESS_TOKEN) {
    const resultado = await enviarPurchaseParaMeta(registro, valor, dataFechamento, telefoneNorm, email);
    enviado = resultado.ok;
    detalheErro = resultado.detalhe;
  } else {
    detalheErro = "META_ACCESS_TOKEN não configurado nesta função ainda";
  }

  await sb.from("eventos_meta").upsert({
    chave_idempotencia: chave,
    telefone_norm: telefoneNorm || null,
    email_norm: email || null,
    nome: venda.nome || null,
    data_evento: dataFechamento,
    valor,
    enviado,
  }, { onConflict: "chave_idempotencia" });

  if (registro) {
    await sb.from("cupons").update({
      venda_id_trinks: `manual-${chave}`,
      venda_valor: valor,
      venda_data: dataFechamento,
      venda_reportada_meta: enviado,
    }).eq("id", registro.id);
  }

  if (!enviado) {
    return { linha, status: "erro_meta", codigo_cupom: registro?.codigo_cupom, detalhe: detalheErro };
  }
  return { linha, status: "enviado", codigo_cupom: registro?.codigo_cupom, detalhe: registro ? "casou com cupom" : "sem cupom, enviado só com telefone/email" };
}

/* ---------- PARSING (formato brasileiro: "R$ 80,00", "27/08/2026") ---------- */

function parseValorBr(valor: string | number | undefined): number | null {
  if (typeof valor === "number") return valor;
  if (!valor) return null;
  const limpo = String(valor).replace(/[^\d,.-]/g, "").trim();
  if (!limpo) return null;
  // formato BR "1.234,56" -> remove pontos de milhar, troca vírgula por ponto
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function parseDataFlexivel(data: string | undefined): string | null {
  if (!data) return null;
  const s = data.trim();
  // DD/MM/YYYY ou DD/MM/YYYY HH:MM
  const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (brMatch) {
    const [, d, m, y, h = "12", min = "00"] = brMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${h.padStart(2, "0")}:${min}:00`;
  }
  // YYYY-MM-DD (já no formato que o Trinks usa no webhook)
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(:\d{2})?)?/);
  if (isoMatch) {
    return `${isoMatch[1]} ${isoMatch[2] || "12:00"}:00`;
  }
  return null;
}

/* ---------- META CONVERSIONS API (mesma lógica do trinks-webhook.ts) ---------- */

async function sha256Hex_(valor: string): Promise<string> {
  const bytes = new TextEncoder().encode(valor);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function enviarPurchaseParaMeta(
  registro: Record<string, any> | null,
  valor: number | null,
  dataFechamento: string | null,
  telefone: string,
  email: string,
): Promise<{ ok: boolean; detalhe?: string }> {
  const userData: Record<string, unknown> = {};
  if (email) userData.em = [await sha256Hex_(email)];
  if (telefone) {
    const comDdi = telefone.length <= 11 ? "55" + telefone : telefone;
    userData.ph = [await sha256Hex_(comDdi)];
  }
  if (registro?.fbc) userData.fbc = registro.fbc;
  if (registro?.fbp) userData.fbp = registro.fbp;

  const eventTime = dataFechamento
    ? Math.floor(new Date(dataFechamento.replace(" ", "T") + "-03:00").getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  // custom_data só entra com value/currency quando a planilha trazia
  // valor de verdade (o relatório de Clientes da Trinks não traz) —
  // nunca inventa número pra não distorcer ROAS no Meta.
  const customData: Record<string, unknown> = { content_name: "venda_fechada_trinks_manual" };
  if (valor !== null) {
    customData.value = valor;
    customData.currency = "BRL";
  }

  const payload = {
    data: [{
      event_name: "Purchase",
      event_time: eventTime,
      action_source: "system_generated",
      event_source_url: EVENT_SOURCE_URL,
      user_data: userData,
      custom_data: customData,
    }],
  };

  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_ACCESS_TOKEN!)}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const texto = await resp.text();
    console.log(`Meta CAPI [${resp.status}]: ${texto}`);
    return { ok: resp.ok, detalhe: resp.ok ? undefined : texto };
  } catch (e) {
    console.error("Erro ao chamar Meta Conversions API:", e);
    return { ok: false, detalhe: String(e) };
  }
}
