/* ==================================================================
   BACKEND — Cupom de Hidratação · Fast Escova Bauru
   Google Apps Script, gratuito, ligado a uma Google Sheet dedicada.
   Mesma arquitetura do CRM de Criadores da Pousada Aimê (ver
   ../../Pousada Aimê/Criadores/Sistema/codigo-apps-script.gs).

   O QUE ESSE SCRIPT FAZ:
   - Recebe nome/telefone/email do formulário público (index.html).
   - Se a pessoa NUNCA cadastrou (por telefone OU email): cria um cupom
     novo, com validade = hoje + 4 dias, e manda o email do cupom.
   - Se a pessoa JÁ cadastrou: NÃO cria outro, devolve o cupom que já existe.
   - Endpoint separado (ação "marcar_compareceu") pra equipe da loja marcar
     que o cupom foi usado presencialmente — depois disso ele não pode
     mais ser resgatado, mesmo dentro do prazo (usado por admin.html).

   COMO INSTALAR (uma vez só):
   1. Crie uma Google Sheet nova, nomeie "Cupons — Fast Escova Bauru".
   2. Renomeie a primeira aba pra "Cupons".
   3. Na célula A1, cole exatamente esta linha (uma linha só, o Sheets
      separa em colunas sozinho ao colar):

      id	data_cadastro	nome	telefone	email	codigo_cupom	data_validade	compareceu	compareceu_em	email_enviado	obs

   4. Menu Extensões → Apps Script. Apague o conteúdo do Code.gs e cole
      este arquivo inteiro.
   5. Menu Configurações do projeto (ícone de engrenagem) → em
      "Propriedades do script", adicione:
      - ADMIN_SENHA = uma senha que a equipe da loja vai usar no painel
        (admin.html) pra marcar cupons como usados.
      NUNCA cole a senha direto no HTML — só aqui.
   6. Implantar → Nova implantação → tipo "Aplicativo da Web".
      Executar como: Eu. Quem pode acessar: Qualquer pessoa.
      Implantar, autorizar o acesso, e copiar a URL que termina em /exec.
   7. Cole essa URL na constante SHEETS_URL de index.html e admin.html.

   Se precisar alterar o código depois: edite aqui, salve, e em
   "Implantar" → "Gerenciar implantações" → editar (ícone de lápis) →
   Nova versão → Implantar. (Só criar implantação nova quebra a URL que
   já está nos HTMLs — sempre reuse a mesma.)
================================================================== */

const SHEET_NAME = 'Cupons';
const VALIDADE_DIAS = 4;
const UNIDADE_ENDERECO = 'R. Antônio Alves, 30-12 — Bauru, SP';
const UNIDADE_HORARIO = 'Segunda a sábado, 8h às 20h · Domingo, 9h às 15h';

/* ---------- ROTEAMENTO ---------- */

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'consultar') {
    return jsonResponse_(consultarCupom_(e.parameter.telefone, e.parameter.email));
  }
  if (action === 'listar_admin') {
    if (!senhaValida_(e.parameter.senha)) return jsonResponse_({ erro: 'senha inválida' });
    return jsonResponse_({ registros: listarRegistros_() });
  }
  return jsonResponse_({ erro: 'ação desconhecida' });
}

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ erro: 'payload inválido' });
  }

  if (payload.action === 'resgatar_cupom') {
    return jsonResponse_(resgatarCupom_(payload));
  }
  if (payload.action === 'marcar_compareceu') {
    if (!senhaValida_(payload.senha)) return jsonResponse_({ erro: 'senha inválida' });
    return jsonResponse_(marcarCompareceu_(payload.codigo_cupom));
  }
  return jsonResponse_({ erro: 'ação desconhecida' });
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function senhaValida_(senha) {
  const esperada = PropertiesService.getScriptProperties().getProperty('ADMIN_SENHA');
  return !!esperada && String(senha) === esperada;
}

/* ---------- PLANILHA ---------- */

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function normTelefone_(v) {
  return String(v || '').replace(/\D/g, '');
}

function normEmail_(v) {
  return String(v || '').trim().toLowerCase();
}

function listarRegistros_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = getHeaders_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map((row, i) => {
    const obj = { _linha: i + 2 };
    headers.forEach((h, j) => { obj[h] = row[j]; });
    return obj;
  });
}

function encontrarRegistro_(telefone, email) {
  const tNorm = normTelefone_(telefone);
  const eNorm = normEmail_(email);
  if (!tNorm && !eNorm) return null;
  const registros = listarRegistros_();
  return registros.find(r =>
    (tNorm && normTelefone_(r.telefone) === tNorm) ||
    (eNorm && normEmail_(r.email) === eNorm)
  ) || null;
}

function gerarCodigoCupom_() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return 'FASTBAURU' + n;
}

function formatarDataBr_(data) {
  return Utilities.formatDate(data, 'America/Sao_Paulo', 'dd/MM/yyyy');
}

function statusCupom_(registro) {
  const compareceu = String(registro.compareceu || '').toLowerCase() === 'sim';
  if (compareceu) return 'usado';
  const hoje = new Date();
  const [d, m, a] = String(registro.data_validade).split('/').map(Number);
  const validade = new Date(a, m - 1, d, 23, 59, 59);
  if (hoje > validade) return 'expirado';
  return 'valido';
}

/* ---------- RESGATE (endpoint principal do formulário) ---------- */

function resgatarCupom_(payload) {
  const nome = String(payload.nome || '').trim();
  const telefone = String(payload.telefone || '').trim();
  const email = String(payload.email || '').trim();

  if (!nome || normTelefone_(telefone).length < 10 || !email) {
    return { ok: false, erro: 'dados incompletos' };
  }

  const existente = encontrarRegistro_(telefone, email);
  if (existente) {
    return {
      ok: true,
      existente: true,
      cupom: montarRespostaCupom_(existente)
    };
  }

  const sheet = getSheet_();
  const headers = getHeaders_(sheet);
  const agora = new Date();
  const validade = new Date(agora.getTime() + VALIDADE_DIAS * 24 * 60 * 60 * 1000);

  const registro = {
    id: 'CUP' + Date.now(),
    data_cadastro: formatarDataBr_(agora),
    nome: nome,
    telefone: telefone,
    email: email,
    codigo_cupom: gerarCodigoCupom_(),
    data_validade: formatarDataBr_(validade),
    compareceu: 'Não',
    compareceu_em: '',
    email_enviado: '',
    obs: ''
  };

  const enviado = enviarEmailCupom_(registro);
  registro.email_enviado = enviado ? 'Sim' : 'Erro';

  const row = headers.map(h => (registro[h] !== undefined ? registro[h] : ''));
  sheet.appendRow(row);

  return {
    ok: true,
    existente: false,
    cupom: montarRespostaCupom_(registro)
  };
}

function montarRespostaCupom_(registro) {
  return {
    nome: registro.nome,
    codigo_cupom: registro.codigo_cupom,
    data_cadastro: registro.data_cadastro,
    data_validade: registro.data_validade,
    status: statusCupom_(registro)
  };
}

/* Endpoint auxiliar (GET) — usado pelo front pra reconsultar o cupom
   depois do POST de resgate (o mesmo truque de duas chamadas usado no
   sistema de Criadores da Aimê: POST no-cors pra escrever, GET normal
   pra ler de volta, sem cair em bloqueio de CORS do Apps Script). */
function consultarCupom_(telefone, email) {
  const registro = encontrarRegistro_(telefone, email);
  if (!registro) return { ok: false, erro: 'não encontrado' };
  return { ok: true, cupom: montarRespostaCupom_(registro) };
}

/* ---------- ADMIN (marcar cupom como usado na loja) ---------- */

function marcarCompareceu_(codigoCupom) {
  const sheet = getSheet_();
  const headers = getHeaders_(sheet);
  const codigoCol = headers.indexOf('codigo_cupom');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, erro: 'sem registros' };

  const codigos = sheet.getRange(2, codigoCol + 1, lastRow - 1, 1).getValues();
  let rowIndex = -1;
  for (let i = 0; i < codigos.length; i++) {
    if (String(codigos[i][0]).toUpperCase() === String(codigoCupom).toUpperCase()) {
      rowIndex = i + 2;
      break;
    }
  }
  if (rowIndex === -1) return { ok: false, erro: 'cupom não encontrado' };

  const compareceuCol = headers.indexOf('compareceu') + 1;
  const compareceuEmCol = headers.indexOf('compareceu_em') + 1;
  sheet.getRange(rowIndex, compareceuCol).setValue('Sim');
  sheet.getRange(rowIndex, compareceuEmCol).setValue(new Date().toLocaleString('pt-BR'));
  return { ok: true };
}

/* ---------- EMAIL ---------- */

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
