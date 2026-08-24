# Setup — Cupom de Hidratação (isca de captura) · Fast Escova Bauru

> Mesma arquitetura já validada no CRM de Criadores da Pousada Aimê: páginas HTML estáticas + Google Sheets/Apps Script como banco de dados grátis. Sem servidor pago, sem mensalidade.

Arquivos desta pasta:
- **`codigo-apps-script.gs`** — backend (roda no Google, grátis): checa duplicidade, calcula validade (+4 dias), gera código do cupom, manda o email, e dá baixa quando a cliente usa na loja.
- **`index.html`** — página pública (formulário → bilhete dourado → download + grupo).
- **`admin.html`** — painel interno pra equipe da loja validar/dar baixa no cupom (evita uso 2x presencial).

---

## Passo a passo

### 1. Criar a conta Google da Fast Escova
Combinado: essa planilha e o envio de email vão rodar numa conta Google própria da Fast Escova (não a conta pessoal da agência), pra o email do cupom chegar como remetente da própria marca. Crie/loge nessa conta antes de seguir.

### 2. Criar a planilha
1. Crie uma Google Sheet nova, nomeie **"Cupons — Fast Escova Bauru"**.
2. Renomeie a primeira aba pra **"Cupons"**.
3. Na célula A1, cole a linha de cabeçalhos que está no topo de `codigo-apps-script.gs` (é uma linha só, separada por tab — cole direto que o Sheets separa nas colunas sozinho):

   ```
   id	data_cadastro	nome	telefone	email	codigo_cupom	data_validade	compareceu	compareceu_em	email_enviado	obs
   ```

### 3. Instalar o backend
1. Nessa mesma planilha: **Extensões → Apps Script**.
2. Apague o conteúdo padrão e cole o `codigo-apps-script.gs` inteiro.
3. **Configurações do projeto** (ícone de engrenagem) → **Propriedades do script** → adicionar:
   - Chave: `ADMIN_SENHA`
   - Valor: uma senha que a equipe da loja vai digitar em `admin.html` pra dar baixa nos cupons. Escolha algo simples de passar pro time, mas não óbvio (o repo é público, então o HTML fica visível, só a senha em si fica protegida no backend).
4. **Implantar → Nova implantação** → tipo "Aplicativo da Web" → Executar como **Eu** → Quem pode acessar **Qualquer pessoa** → Implantar.
5. Autorize o acesso quando pedir. Copie a URL final (termina em `/exec`).

### 4. Configurar as páginas
1. Abra `index.html` e `admin.html`.
2. Em ambos, cole a URL do passo anterior na constante `SHEETS_URL` (dentro do `<script>`, perto do topo).
3. Em `index.html`, troque `WHATSAPP_GRUPO_URL` pelo link real do grupo/comunidade da Fast Escova Bauru assim que tiver — até lá o botão fica com um placeholder.

### 5. Publicar
Repositório GitHub: `pousadaaime/fastescova-cupom-bauru` (mesma conta de deploy usada nos outros projetos deste vault).
- **Página do cupom (pública):** https://pousadaaime.github.io/fastescova-cupom-bauru/
- **Painel de validação (uso interno da loja):** https://pousadaaime.github.io/fastescova-cupom-bauru/admin.html

### 6. Testar antes de divulgar
1. Preencha o formulário publicado com um dado de teste (seu próprio nome/telefone/email).
2. Confira se o email do cupom chegou.
3. Preencha de novo com o **mesmo** telefone ou email — confirme que aparece "Você já tem cadastro" com o **mesmo** código, e que nenhuma linha nova foi criada na planilha.
4. Abra `admin.html`, digite a senha (`ADMIN_SENHA`) e o código do cupom de teste, clique em **Marcar como usado agora**.
5. Volte na página pública e resgate de novo com os mesmos dados — confirme que aparece "Cupom já utilizado" e o botão de download some.
6. No Apps Script, **Execuções** (ícone de relógio) → confira se `enviarEmailCupom_` rodou sem erro. Se `email_enviado` ficar "Erro" na planilha, é sinal de bloqueio de cota do Gmail/MailApp — reveja permissões da conta.

---

## Como funciona a regra de "não pode usar 2x"

- **Duplicidade no cadastro**: o backend procura, em toda a planilha, se o telefone OU o email já apareceu antes. Se sim, devolve o cupom existente em vez de criar um novo — a pessoa não consegue gerar um segundo cupom trocando só um dos dados.
- **Já foi até a loja**: isso não dá pra checar automaticamente (o script não sabe quem passou na porta). Por isso existe o `admin.html` — a atendente confere o código no balcão e marca **"Marcar como usado agora"**. A partir daí, mesmo dentro do prazo de 4 dias, o cupom aparece como "já utilizado" pra qualquer nova tentativa de acesso.
- **Validade automática**: calculada no momento do cadastro (`data_cadastro + 4 dias`), gravada na planilha, e reexibida sempre que a pessoa reabrir a página — não depende do relógio do celular de ninguém.

## O que ficou de propósito fora do escopo

- **Envio automático por WhatsApp** — o cupom só vai por email (como pedido). Se quiser adicionar depois, dá pra reaproveitar o mesmo padrão do `WHATSAPP_TOKEN` usado no sistema de Criadores da Aimê.
- **Link do grupo** — ainda não informado. Constante `WHATSAPP_GRUPO_URL` em `index.html` fica com placeholder até você mandar o link real.
- **Métrica de campanha (Meta Pixel)** — não foi pedido nesta isca. Se for rodar tráfego pago pra essa página, é só avisar que a gente adiciona o pixel (mesmo padrão usado nas outras LPs do vault).
