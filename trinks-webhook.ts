// ==================================================================
// EDGE FUNCTION — Recebe "Fechamento de Conta" da Trinks e reporta a
// venda pro Meta Conversions API, atribuída ao clique de anúncio que
// originou o lead (fbclid/fbc/fbp salvos no cadastro do cupom).
//
// COMO INSTALAR (uma vez, depois que o token da API da Trinks chegar):
// 1. No painel do Supabase: Edge Functions → Deploy a new function.
// 2. Nome da função: trinks-webhook
// 3. Cole este arquivo inteiro no editor e faça o deploy.
// 4. Em Edge Functions → trinks-webhook → Secrets (ou via CLI:
//    supabase secrets set META_ACCESS_TOKEN=...), adicione:
//      META_ACCESS_TOKEN = token do Meta com permissão ads_management
//      pro pixel 2253088758874211 (o token de 27/08 é só leitura,
//      NÃO serve — precisa gerar um novo em Configurações do Negócio
//      → Usuários do sistema → Gerar novo token).
//    (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos
//    automaticamente em toda Edge Function, não precisa configurar.)
// 5. Copie a URL da função (algo como
//    https://bsemnxcfdzdyokxidafu.supabase.co/functions/v1/trinks-webhook)
// 6. Dentro do Trinks (ou com quem estiver configurando o Conecta
//    Trinks), cadastre essa URL como destino do webhook de
//    "Fechamento de Conta".
// 7. No primeiro cadastro, a Trinks manda uma mensagem
//    "SubscriptionConfirmation" — esta função já confirma sozinha
//    (visita a SubscribeURL automaticamente). Depois disso os eventos
//    de venda começam a chegar.
//
// Rode `supabase-migration-02-atribuicao-meta.sql` no SQL Editor ANTES
// de ativar isso — a função depende das colunas fbclid/fbc/fbp/venda_*
// que esse script cria na tabela `cupons`.
// ==================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createVerify, X509Certificate } from "node:crypto";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN");
const META_PIXEL_ID = "2253088758874211";
const META_API_VERSION = "v20.0";
const EVENT_SOURCE_URL = "https://fastescovabauru.github.io/cupom/";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const valido = await verificarAssinaturaSns(body).catch((e) => {
    console.error("Erro validando assinatura SNS:", e);
    return false;
  });
  if (!valido) {
    console.error("Assinatura SNS inválida — mensagem rejeitada.");
    return new Response("assinatura inválida", { status: 403 });
  }

  if (body.Type === "SubscriptionConfirmation") {
    // confirma a assinatura do tópico visitando a SubscribeURL — sem
    // isso a Trinks/SNS nunca começa a mandar os eventos de verdade.
    try {
      await fetch(String(body.SubscribeURL));
      console.log("Assinatura SNS confirmada.");
    } catch (e) {
      console.error("Falha ao confirmar assinatura SNS:", e);
      return new Response("falha ao confirmar", { status: 500 });
    }
    return new Response("confirmado", { status: 200 });
  }

  if (body.Type === "Notification") {
    await processarNotificacao(body);
    return new Response("ok", { status: 200 });
  }

  return new Response("tipo desconhecido, ignorado", { status: 200 });
});

/* ---------- SEGURANÇA: valida que a mensagem é mesmo da AWS SNS ---------- */

async function verificarAssinaturaSns(msg: Record<string, unknown>): Promise<boolean> {
  const signingCertUrl = msg.SigningCertURL as string | undefined;
  const signature = msg.Signature as string | undefined;
  if (!signingCertUrl || !signature) return false;

  // só aceita certificado hospedado de verdade num domínio da AWS SNS —
  // evita que alguém aponte pra um certificado forjado em outro servidor
  const certUrl = new URL(signingCertUrl);
  if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(certUrl.hostname)) {
    console.error("SigningCertURL fora do domínio esperado:", certUrl.hostname);
    return false;
  }

  const stringToSign = construirStringParaAssinar(msg);
  const certPem = await (await fetch(signingCertUrl)).text();
  const cert = new X509Certificate(certPem);

  const verify = createVerify("RSA-SHA1");
  verify.update(stringToSign, "utf8");
  return verify.verify(cert.publicKey, signature, "base64");
}

function construirStringParaAssinar(msg: Record<string, unknown>): string {
  const campos = msg.Type === "SubscriptionConfirmation" || msg.Type === "UnsubscribeConfirmation"
    ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
    : ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
  let str = "";
  for (const campo of campos) {
    const valor = msg[campo];
    if (valor !== undefined && valor !== null) {
      str += `${campo}\n${valor}\n`;
    }
  }
  return str;
}

/* ---------- PROCESSAMENTO DO EVENTO DA TRINKS ---------- */

interface TelefoneTrinks { TelefoneCompleto?: string }

async function processarNotificacao(envelope: Record<string, unknown>) {
  let evento: Record<string, unknown>;
  try {
    evento = JSON.parse(String(envelope.Message));
  } catch (e) {
    console.error("Message da Trinks não é JSON válido:", e);
    return;
  }

  // só nos interessa TipoDeEvento 1 = Fechamento de Conta (venda fechada)
  if (evento.TipoDeEvento !== 1) {
    console.log("Evento ignorado (TipoDeEvento != 1):", evento.TipoDeEvento);
    return;
  }

  const email = String(evento.EmailDoCliente || "").trim().toLowerCase();
  const telefones = ((evento.TelefoneDoCliente as TelefoneTrinks[]) || [])
    .map((t) => String(t.TelefoneCompleto || "").replace(/\D/g, ""))
    .filter(Boolean);
  const valor = Number(evento.ValorDaCompra) || 0;
  const idTransacao = String(evento.IdDaTransacao || "");
  const dataFechamento = (evento.DataDoFechamento as string) || null;

  if (!idTransacao) {
    console.error("Evento de fechamento sem IdDaTransacao — ignorando.");
    return;
  }

  // procura o lead na nossa base por qualquer telefone da lista, depois por email
  let registro: Record<string, any> | null = null;
  for (const tel of telefones) {
    const { data } = await sb.from("cupons").select("*").eq("telefone_norm", tel).maybeSingle();
    if (data) { registro = data; break; }
  }
  if (!registro && email) {
    const { data } = await sb.from("cupons").select("*").eq("email_norm", email).maybeSingle();
    if (data) registro = data;
  }

  if (!registro) {
    console.log(`Venda fechada (transação ${idTransacao}) sem lead correspondente na nossa base — não veio do cupom/anúncio.`);
    return;
  }

  // idempotência: essa mesma transação já foi processada antes?
  if (registro.venda_id_trinks === idTransacao && registro.venda_reportada_meta) {
    console.log("Transação já processada, ignorando reenvio:", idTransacao);
    return;
  }

  let enviado = false;
  if (META_ACCESS_TOKEN) {
    enviado = await enviarPurchaseParaMeta(registro, valor, dataFechamento, telefones[0] || "", email);
  } else {
    console.warn("META_ACCESS_TOKEN não configurado — venda será salva mas NÃO reportada ao Meta ainda.");
  }

  await sb.from("cupons").update({
    venda_id_trinks: idTransacao,
    venda_valor: valor,
    venda_data: dataFechamento,
    venda_reportada_meta: enviado,
  }).eq("id", registro.id);

  console.log(`Venda ${idTransacao} (R$ ${valor}) vinculada ao lead ${registro.codigo_cupom}. Reportado ao Meta: ${enviado}`);
}

/* ---------- META CONVERSIONS API ---------- */

async function sha256Hex_(valor: string): Promise<string> {
  const bytes = new TextEncoder().encode(valor);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function enviarPurchaseParaMeta(
  registro: Record<string, any>,
  valor: number,
  dataFechamento: string | null,
  telefone: string,
  email: string,
): Promise<boolean> {
  const userData: Record<string, unknown> = {};
  if (email) userData.em = [await sha256Hex_(email)];
  if (telefone) {
    const comDdi = telefone.length <= 11 ? "55" + telefone : telefone;
    userData.ph = [await sha256Hex_(comDdi)];
  }
  if (registro.fbc) userData.fbc = registro.fbc;
  if (registro.fbp) userData.fbp = registro.fbp;

  // Trinks manda a data em horário de Brasília (America/Sao_Paulo, UTC-3,
  // sem horário de verão) — assume esse offset fixo pra converter.
  const eventTime = dataFechamento
    ? Math.floor(new Date(dataFechamento.replace(" ", "T") + "-03:00").getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const payload = {
    data: [{
      event_name: "Purchase",
      event_time: eventTime,
      action_source: "system_generated",
      event_source_url: EVENT_SOURCE_URL,
      user_data: userData,
      custom_data: {
        value: valor,
        currency: "BRL",
        content_name: "venda_fechada_trinks",
      },
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
    return resp.ok;
  } catch (e) {
    console.error("Erro ao chamar Meta Conversions API:", e);
    return false;
  }
}
