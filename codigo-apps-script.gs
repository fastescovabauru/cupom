/* ==================================================================
   BACKEND DE EMAIL — Cupom de Hidratação · Fast Escova Bauru
   Google Apps Script, gratuito. Único trabalho deste script: mandar
   o email do cupom quando o Supabase confirma um cadastro novo.

   Os dados (cupom, duplicidade, validade, dar baixa no cupom) vivem
   inteiramente no Supabase agora (ver supabase-schema.sql e
   README-setup.md) — esse script NÃO lê nem escreve em nenhuma
   planilha, só envia o email.

   COMO INSTALAR (uma vez só, na conta Google da Fast Escova):
   1. script.google.com → Novo projeto (não precisa de planilha).
   2. Apague o conteúdo do Code.gs e cole este arquivo inteiro.
   3. Implantar → Nova implantação → tipo "Aplicativo da Web".
      Executar como: Eu. Quem pode acessar: Qualquer pessoa.
      Implantar, autorizar o acesso, e copiar a URL que termina em /exec.
   4. Cole essa URL na constante EMAIL_URL de index.html.

   Se alterar o código depois: edite aqui, salve, e em "Implantar" →
   "Gerenciar implantações" → editar (ícone de lápis) → Nova versão →
   Implantar. (Só criar implantação nova quebra a URL que já está no
   index.html — sempre reuse a mesma.)
================================================================== */

const UNIDADE_ENDERECO = 'R. Antônio Alves, 30-12 — Bauru, SP';
const UNIDADE_HORARIO = 'Segunda a sábado, 8h às 20h · Domingo, 9h às 15h';

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ erro: 'payload inválido' });
  }

  if (payload.action === 'enviar_email_cupom') {
    const enviado = enviarEmailCupom_(payload);
    return jsonResponse_({ ok: enviado });
  }
  return jsonResponse_({ erro: 'ação desconhecida' });
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function enviarEmailCupom_(registro) {
  try {
    const assunto = '🎟️ Seu cupom de Hidratação grátis — Fast Escova Bauru';
    const corpoHtml = `
      <div style="background:#111;padding:32px 16px;font-family:Arial,sans-serif">
        <div style="max-width:420px;margin:0 auto;background:#161616;border:1.5px solid #d4af37;border-radius:16px;overflow:hidden">
          <div style="background:#d4af37;color:#111;text-align:center;padding:14px;font-weight:bold;letter-spacing:1px;font-size:13px">
            CUPOM VÁLIDO NA 1ª VISITA
          </div>
          <div style="padding:26px 24px;text-align:center">
            <div style="font-size:22px;color:#fff;font-style:italic">fast<span style="color:#d4af37;font-style:normal;font-weight:bold">escova</span></div>
            <div style="color:#bbb;font-size:11px;letter-spacing:3px;margin-top:2px">BAURU</div>
            <h1 style="color:#d4af37;font-size:20px;margin:22px 0 4px">Hidratação grátis</h1>
            <p style="color:#ddd;font-size:14px;margin:0 0 20px">pra você, ${escapeHtml_(registro.nome)}</p>
            <div style="background:#000;border:1.5px dashed #d4af37;border-radius:10px;padding:16px;margin-bottom:20px">
              <div style="color:#999;font-size:11px;letter-spacing:1px">CÓDIGO DO CUPOM</div>
              <div style="color:#fff;font-size:26px;font-weight:bold;letter-spacing:2px;margin-top:4px">${escapeHtml_(registro.codigo_cupom)}</div>
            </div>
            <p style="color:#ddd;font-size:14px;margin:0 0 6px"><strong style="color:#d4af37">Válido até:</strong> ${escapeHtml_(registro.data_validade)}</p>
            <p style="color:#999;font-size:12.5px;margin:14px 0 0;line-height:1.5">
              Válido apenas na unidade Fast Escova Bauru<br>
              ${escapeHtml_(UNIDADE_ENDERECO)}<br>
              ${escapeHtml_(UNIDADE_HORARIO)}<br>
              Sem hora marcada · Uso único · Não cumulativo
            </p>
          </div>
        </div>
      </div>
    `;
    MailApp.sendEmail({
      to: registro.email,
      subject: assunto,
      htmlBody: corpoHtml,
      body: `Seu cupom de hidratação grátis Fast Escova Bauru: ${registro.codigo_cupom}. Válido até ${registro.data_validade}. Endereço: ${UNIDADE_ENDERECO}.`
    });
    return true;
  } catch (err) {
    Logger.log('Erro ao enviar email do cupom: ' + err);
    return false;
  }
}

function escapeHtml_(v) {
  return String(v || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
