# Setup — Cupom de Hidratação (isca de captura) · Fast Escova Bauru

Arquivos desta pasta:
- **`supabase-schema.sql`** — banco de dados: tabela de cupons, checagem de duplicidade, cálculo de validade (+4 dias), geração do código, e dar baixa quando a cliente usa na loja. Roda no Supabase (grátis).
- **`supabase-migration-02-atribuicao-meta.sql`** — adiciona as colunas de rastreio de anúncio (fbclid/fbc/fbp) e de venda (venda_valor, venda_reportada_meta etc.) numa base que já rodou o `supabase-schema.sql` antes. Rode só uma vez, depois do schema principal.
- **`codigo-apps-script.gs`** — só manda o email do cupom (Google Apps Script, grátis). Não guarda mais nenhum dado — quem guarda é o Supabase.
- **`trinks-webhook.ts`** — Edge Function do Supabase: recebe o evento "Fechamento de Conta" da Trinks (venda fechada) e reporta pro Meta Conversions API, atribuída ao clique de anúncio que originou o lead. Ver seção "Atribuição Trinks → Meta Ads" abaixo. **Só entra em uso quando a API paga da Trinks for contratada** (R$84/mês, faixa 11-15 profissionais).
- **`importar-vendas-manual.ts`** + **`importar-vendas.html`** — versão gratuita/manual do passo acima, pra usar **enquanto a API paga não é contratada** (combinado: 30 dias de teste manual, 2x por semana). Ver seção "Importação manual de vendas" abaixo.
- **`index.html`** — página pública (formulário → bilhete dourado na hora → download + grupo). Também captura o fbclid/fbc/fbp do clique do anúncio no momento do cadastro.
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

### 5. Publicar — ✅ feito em 27/08/2026
Repositório: [github.com/fastescovabauru/cupom](https://github.com/fastescovabauru/cupom) (transferido da conta Pousada Aimê, depois renomeado de `fastescova-cupom-bauru` pra `cupom` — URL curta).
- **Página do cupom (pública):** https://fastescovabauru.github.io/cupom/
- **Painel de validação (uso interno da loja):** https://fastescovabauru.github.io/cupom/admin.html

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

## Importação manual de vendas (período de 30 dias, sem a API paga)

Combinado em 27/08/2026: por 30 dias a Luana sobe manualmente 2x por semana o relatório de vendas exportado da Trinks, em vez de pagar a API agora. No mês seguinte, contrata a API (ver seção abaixo) e troca pra tempo real.

### Passo a passo pra ativar

1. **Publicar a Edge Function**: Supabase → **Edge Functions → Deploy a new function** → nome `importar-vendas-manual` → colar `importar-vendas-manual.ts` inteiro → Deploy.
2. **Gerar o token do Meta com permissão `ads_management`** (mesmo passo da seção de baixo) e colar em Edge Functions → `importar-vendas-manual` → **Secrets**, chave `META_ACCESS_TOKEN`. Sem isso, a ferramenta casa os leads e salva o valor da venda, mas não consegue mandar pro Meta ainda.
3. Copiar a URL da função e colar em `importar-vendas.html`, na constante `IMPORTAR_VENDAS_URL`.
4. Publicar (`git add` + commit + push, ou pedir pra mim).

### Como usar (2x por semana)

1. Na Trinks, exportar o relatório de vendas/fechamentos do período (Financeiro → Relatórios, ou tela equivalente — a Luana confirma o caminho exato de exportação do plano dela).
2. Abrir **`https://fastescovabauru.github.io/cupom/importar-vendas.html`**.
3. Colar a senha do painel (mesma do `admin.html`).
4. Colar as linhas exportadas (ou enviar o arquivo) e clicar **Ler planilha**.
5. Conferir se as colunas casaram certo (Nome/Telefone/Email/Valor/Data) — a ferramenta tenta adivinhar sozinha, mas vale olhar antes de processar.
6. Clicar **Processar e enviar pro Meta** e conferir o resumo: quantas venderam bateram com cupom, quantas já tinham sido processadas antes (não duplica), quantas não bateram com nenhum lead.

A ferramenta é segura de rodar mais de uma vez com a mesma planilha — linhas já processadas (mesmo telefone + data + valor) não geram evento duplicado no Meta.

## Atribuição Trinks → Meta Ads (venda fechada na loja → campanha certa, tempo real)

Quando a API paga for contratada (R$84/mês, faixa 11-15 profissionais — ver conversa com a Trinks), trocamos a importação manual acima pelo webhook automático abaixo.

A Trinks não integra direto com o Pixel, mas tem uma API/Webhooks oficial ("Conecta Trinks", doc em https://trinks.readme.io/) — usamos o evento de webhook **"Fechamento de Conta"**, que já vem com nome/telefone/email/valor da venda no próprio payload, sem precisar de outra chamada.

Fluxo completo:
1. Lead clica num anúncio → cai na página do cupom → `index.html` guarda `fbclid`/`fbc`/`fbp` junto com o cadastro (isso só existe nesse momento — por isso já está ativo mesmo antes do resto estar pronto).
2. Cliente vai até a loja, fecha qualquer serviço, a conta é fechada no Trinks.
3. Trinks dispara o webhook de Fechamento de Conta → `trinks-webhook.ts` (Edge Function no Supabase) recebe.
4. A função bate telefone/email do evento contra a tabela `cupons`, acha o lead, e manda um evento **Purchase** pro Meta Conversions API com o valor real da venda + o `fbc`/`fbp` salvos no passo 1 — é isso que faz o Meta atribuir a venda de volta à campanha/anúncio certo.

### Passo a passo pra ativar

1. **Pedir acesso à API da Trinks** (só quem tem login na conta Trinks consegue — eu não entro com a senha de vocês): dentro do Trinks, **Fale Conosco** → pedir liberação da API/Webhooks, informando nome e email do responsável técnico. Em até 48h o token aparece em **Minha Área → Meu Cadastro**.
2. **Rodar `supabase-migration-02-atribuicao-meta.sql`** no SQL Editor do Supabase (cria as colunas que a função abaixo usa).
3. **Publicar a Edge Function**: Supabase → **Edge Functions → Deploy a new function** → nome `trinks-webhook` → colar `trinks-webhook.ts` inteiro → Deploy. Copiar a URL gerada.
4. **Gerar um token do Meta com permissão `ads_management`** pro pixel `2253088758874211` (Configurações do Negócio → Usuários do sistema → Gerar novo token — o token enviado em 27/08 é só leitura, não serve pra isso). Colar em Edge Functions → `trinks-webhook` → **Secrets**, chave `META_ACCESS_TOKEN`.
5. **Cadastrar a URL da Edge Function na Trinks** como destino do webhook de "Fechamento de Conta" (isso é configurado pela própria Trinks/equipe técnica dela, usando o token do passo 1).
6. No primeiro cadastro, chega uma mensagem de confirmação de assinatura (SNS) — a função já confirma sozinha, não precisa fazer nada manual.

### Testar

Feche uma conta de teste no Trinks pra um cliente com telefone/email que bata com um cupom de teste já resgatado na página. Depois confira:
- Supabase → Table Editor → `cupons`: a linha deve ter `venda_reportada_meta = true` e `venda_valor` preenchido.
- Meta Gerenciador de Eventos → aba "Servidor" do pixel `2253088758874211`: deve aparecer um evento `Purchase` recente.
- Se `venda_reportada_meta` ficar `false`: veja os Logs da Edge Function no Supabase — provavelmente `META_ACCESS_TOKEN` não está configurado ou está com escopo errado.

## Pendências (ver também `../../acessos.md`)

- [x] ~~Aceitar a transferência do GitHub~~ — feito em 27/08/2026.
- [x] ~~Encurtar a URL~~ — repo renomeado pra `fastescovabauru/cupom`, link agora é https://fastescovabauru.github.io/cupom/
- [ ] **Deploy do Apps Script de email** — sem isso o cupom aparece na tela mas não sai por email ainda.
- [ ] **Trocar a senha padrão do admin** no Supabase (`config_admin`, ver `../../acessos.md`).
- [ ] **Link do grupo VIP** (WhatsApp) — campo ainda veio em branco.
- [ ] **Atribuição Trinks → Meta** (seção acima): pedir acesso à API da Trinks, rodar a migration 02, publicar a Edge Function, gerar token `ads_management` do Meta.
- [ ] **Google Ads** — acesso ainda não liberado (avisar quando tiver, caso vá rodar tráfego pago pra essa página).

## O que ficou de propósito fora do escopo

- **Envio automático por WhatsApp** — o cupom só vai por email (como pedido).
- **Chave `service_role` do Supabase** — nunca deve ir pra nenhum HTML público. Só a `anon public` (que já é protegida pelas regras do `supabase-schema.sql`).
