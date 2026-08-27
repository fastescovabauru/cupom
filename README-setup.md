# Setup — Cupom de Hidratação (isca de captura) · Fast Escova Bauru

Arquivos desta pasta:
- **`supabase-schema.sql`** — banco de dados: tabela de cupons, checagem de duplicidade, cálculo de validade (+4 dias), geração do código, e dar baixa quando a cliente usa na loja. Roda no Supabase (grátis).
- **`codigo-apps-script.gs`** — só manda o email do cupom (Google Apps Script, grátis). Não guarda mais nenhum dado — quem guarda é o Supabase.
- **`index.html`** — página pública (formulário → bilhete dourado na hora → download + grupo).
- **`admin.html`** — painel interno pra equipe da loja validar/dar baixa no cupom (evita uso 2x presencial).

---

## Passo a passo

### 1. Rodar o schema no Supabase
1. Abra o projeto Supabase já conectado (o que já está linkado ao GitHub).
2. Menu lateral → **SQL Editor** → **New query**.
3. Cole o conteúdo inteiro de `supabase-schema.sql` e clique **Run**.
4. Antes de rodar (ou logo depois, editando), troque `'TROQUE_ESSA_SENHA'` pela senha que a equipe da loja vai usar em `admin.html` pra dar baixa nos cupons.

### 2. Pegar as chaves do Supabase
1. No projeto: **Settings (ícone de engrenagem) → API**.
2. Copie **Project URL** e a chave **anon public** (a outra, `service_role`, NUNCA cole em HTML — essa sim precisa ficar em segredo).
3. Cole as duas em `index.html` e `admin.html`, nas constantes `SUPABASE_URL` e `SUPABASE_ANON_KEY` (topo do `<script>`).

> As duas chaves acima são seguras de expor no front-end — é assim que o Supabase funciona. Quem protege os dados são as regras dentro de `supabase-schema.sql` (RLS + funções), não o segredo da chave.

### 3. Instalar o envio de email (Apps Script)
1. Na conta Google da Fast Escova (baurufastescova@gmail.com): **script.google.com → Novo projeto** (não precisa criar planilha nenhuma).
2. Apague o conteúdo padrão e cole `codigo-apps-script.gs` inteiro.
3. **Implantar → Nova implantação** → tipo "Aplicativo da Web" → Executar como **Eu** → Quem pode acessar **Qualquer pessoa** → Implantar.
4. Autorize o acesso quando pedir. Copie a URL final (termina em `/exec`).
5. Cole essa URL em `index.html`, na constante `EMAIL_URL`.

### 4. Link do grupo
Em `index.html`, troque `WHATSAPP_GRUPO_URL` pelo link real do grupo/comunidade da Fast Escova Bauru assim que tiver.

### 5. Publicar
Repositório: (mover pra conta própria da Fast Escova no GitHub — ver pendência abaixo).
- **Página do cupom (pública):** `https://{usuario}.github.io/fastescova-cupom-bauru/`
- **Painel de validação (uso interno da loja):** `https://{usuario}.github.io/fastescova-cupom-bauru/admin.html`

### 6. Testar antes de divulgar
1. Preencha o formulário publicado com um dado de teste (seu próprio nome/telefone/email).
2. Confira se o email do cupom chegou.
3. Preencha de novo com o **mesmo** telefone ou email — confirme que aparece "Você já tem cadastro" com o **mesmo** código, e que **não** chega um segundo email.
4. Abra `admin.html`, digite a senha (a que você colocou em `config_admin` no passo 1) e o código do cupom de teste, clique em **Marcar como usado agora**.
5. Volte na página pública e resgate de novo com os mesmos dados — confirme que aparece "Cupom já utilizado" e o botão de download some.
6. No Supabase: **Table Editor → cupons**, confirme que a linha de teste está lá com `email_enviado = true`.

---

## Como funciona a regra de "não pode usar 2x"

- **Duplicidade no cadastro**: a função `resgatar_cupom` (dentro do Supabase) procura, em toda a tabela, se o telefone OU o email já apareceu antes. Se sim, devolve o cupom existente em vez de criar um novo — a pessoa não consegue gerar um segundo cupom trocando só um dos dados.
- **Já foi até a loja**: isso não dá pra checar automaticamente (o sistema não sabe quem passou na porta). Por isso existe o `admin.html` — a atendente confere o código no balcão e marca **"Marcar como usado agora"**. A partir daí, mesmo dentro do prazo de 4 dias, o cupom aparece como "já utilizado" pra qualquer nova tentativa de acesso.
- **Validade automática**: calculada no momento do cadastro (`data_cadastro + 4 dias`), gravada no banco, e reexibida sempre que a pessoa reabrir a página — não depende do relógio do celular de ninguém.

## Pendências (ver também `../../acessos.md`)

- [ ] **Mover o repositório**: hoje está em `github.com/pousadaaime/fastescova-cupom-bauru` (temporário). Falta o **usuário/link da conta GitHub própria da Fast Escova** pra eu transferir o repo pra lá e ativar o Pages nessa conta — só depois disso apago o da Pousada Aimê.
- [ ] **Rodar o schema no Supabase** e me passar `SUPABASE_URL` + `anon key` (passo 1-2 acima) — ou me dar acesso ao projeto que eu mesma rodo.
- [ ] **Link do grupo VIP** (WhatsApp) — campo veio em branco na última mensagem.
- [ ] **Pixel do Facebook + API de Conversões** — aguardando o cliente enviar. Quando chegar, adiciono na página (mesmo padrão usado nas outras LPs do vault).
- [ ] **Google Ads** — acesso ainda não liberado (avisar quando tiver, caso vá rodar tráfego pago pra essa página).

## O que ficou de propósito fora do escopo

- **Envio automático por WhatsApp** — o cupom só vai por email (como pedido).
- **Chave `service_role` do Supabase** — nunca deve ir pra nenhum HTML público. Só a `anon public` (que já é protegida pelas regras do `supabase-schema.sql`).
