# Tralked

Tralked é uma plataforma de notícias, guias e progressão para quem joga: catálogo de jogos, guias 100% votados pela comunidade, conquistas e raridade vindas da Steam, ranking de highscores por habilidade, missões diárias e um modo família.
O app lê a biblioteca Steam do jogador, calcula XP, vocação e streak, e mostra tudo isso em um perfil público.

## Requisitos

- Node.js 24
- pnpm 10 (`corepack enable` já resolve)
- Docker (para o Postgres local)

## Como rodar

```bash
pnpm install
cp .env.example .env     # preencha SESSION_SECRET (>= 32 caracteres) se quiser; em dev há um valor padrão
pnpm db:up               # sobe o Postgres `gamelog-db` em localhost:5433
pnpm db:migrate          # aplica as migrations do Prisma
pnpm db:seed             # catálogo de exemplo: jogos, guias, notícias e usuários
pnpm dev                 # http://localhost:3000
```

### Entrar em desenvolvimento

A conta é do próprio Tralked: e-mail + senha em `/entrar` (criar conta em `/cadastrar`). O seed dá ao admin `lucas` um e-mail e uma senha **só de desenvolvimento**, definidos em `prisma/seed-data/users.ts` (`LUCAS_DEV_LOGIN`); os outros usuários do seed não têm credenciais. Nunca use essas credenciais fora de um banco local.

Atalho: `http://localhost:3000/api/auth/demo` cria uma sessão como `lucas` e redireciona para `/jogador/lucas`. A rota só existe fora de produção (`NODE_ENV !== "production"`) e responde 404 quando `STEAM_API_KEY` está configurada.

## Contas e papéis

- **Login**: conta do Tralked, com **e-mail + senha** (`/entrar`, `/cadastrar`; sessão no cookie `gl_session`). A senha é guardada só como hash scrypt (`src/lib/auth/password.ts`); o login responde "E-mail ou senha incorretos" igual para e-mail desconhecido e senha errada, e limita tentativas por IP e por e-mail (em memória, por instância). Google é opcional (com `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), em `/entrar` e como conexão. **Não existe mais login pela Steam**: a Steam é uma conexão. O Tralked nunca pede senha nem token de outros serviços (Steam, PSN, Xbox, Google); a única senha é a do próprio Tralked.
- **Esqueci a senha** (`/esqueci-senha` → `/redefinir-senha?token=`): a resposta é sempre a mesma; o link vale 1 h, funciona uma vez e o banco guarda só o hash do token. Sem provedor de e-mail ainda, **fora de produção o link sai no console do servidor** (`[senha] Link para definir a senha de …`); em produção nada é impresso (use `pnpm user:invite`). Com `DEV_MAIL_LOG_FILE` definido (os e2e definem), o link também é gravado nesse arquivo, só fora de produção. E-mail e senha se trocam em `/conta`.
- **Contas vinculadas** (`/conta/conexoes`): Steam, PSN, Xbox e RetroAchievements pelo modelo Exophase. Um formulário "Serviços" tem um campo por plataforma (Steam: link do perfil, nome personalizado ou SteamID64; PSN: ID online; Xbox: gamertag; RA: usuário) e um "Salvar alterações" que aplica todos os campos de uma vez, com o resultado embaixo de cada um. **Não há código para conectar**: ao salvar, o Tralked confere que o perfil existe e é público (Steam: perfil público e, com `STEAM_API_KEY`, detalhes de jogos públicos; sem a chave isso só aparece na primeira importação; PSN/Xbox/RA: perfil encontrado pela conta de serviço), grava a conexão como ativa e **não verificada** (`LinkedAccount.linkedAt`; `verifiedAt` fica para quem provou a posse) e começa a importação em segundo plano. Conexões não verificadas sincronizam e rendem XP normalmente; o perfil do jogador e a tela de conexões mostram "não verificada". Esvaziar um campo desconecta, e trocar a conta de um campo substitui a anterior: as duas coisas anulam no ledger o XP que veio da conta (sem apagar; para a Steam, cujas entradas não levam plataforma, pelas conquistas e jogos Steam do jogador) e por isso pedem confirmação antes: um diálogo, e também a etapa "Confirme antes de salvar" que o servidor devolve no próprio formulário (o servidor nunca desconecta sem a confirmação). Uma plataforma "Em breve" que já estava conectada mantém o botão "Desconectar…". Cada busca de perfil conta num limite por usuário (12 a cada 15 min, em memória). A Steam conectada preenche `User.steamId`. Abaixo do formulário: "Confira as suas configurações de privacidade se nenhum jogo aparecer" (leva à seção "Como deixar o perfil público" da própria página, com o passo a passo de cada plataforma) e "Precisa sincronizar agora? Sincronizar" (respeita o intervalo mínimo de sincronização).
- **Unicidade e "Reivindicar"**: uma conta de plataforma (plataforma + id externo) só fica em um perfil do Tralked. Se já estiver em outro (inclusive uma Steam de conta antiga, via `User.steamId`), o salvar recusa com "Essa conta já está conectada a outro perfil" e oferece "É sua? Reivindicar". Só a reivindicação pede prova de posse: o Tralked gera um código `TRK-XXXXXX` (vale 30 min), a pessoa cola no "Resumo" (Steam), "Sobre mim" (PSN), bio (Xbox) ou lema (RA) e confirma; o Tralked lê o perfil público (Steam: `steamcommunity.com/profiles/<id>?xml=1`, campo `<summary>`). Provado, a conexão passa para quem reivindicou como **verificada**, o perfil anterior perde a conta pelo mesmo caminho do desvínculo (XP dela anulado, conquistas importadas removidas) e recebe uma notificação. Em desenvolvimento os perfis vêm das fixtures (`src/lib/integrations/steam/fixture.ts` → `STEAM_FIXTURE_PROFILES`, e `src/lib/integrations/{psn,xbox,retro}/fixture.ts`).
- **Contas antigas (do login Steam)**: quem entrava pela Steam (ex.: `mrdead`, `diguzz`) tem conta sem e-mail e sem senha. Digitar essa Steam numa conta nova é recusado como "já conectada a outro perfil"; o histórico só é recuperado pela **reivindicação** (código no Resumo): o e-mail/senha da conta nova passam para a conta antiga (que mantém @, XP, conquistas e papel), a conta nova (ainda vazia) é apagada e a sessão muda para a antiga. Se a conta nova já tem atividade (inclusive outra plataforma conectada), as duas não são juntadas e a mensagem indica o contato. Se a conta antiga já tem senha ou Google, a reivindicação apenas move a Steam (como qualquer outra). Para dar acesso direto a uma conta antiga (ex.: o admin): `DATABASE_URL=... APP_URL=... pnpm user:invite <handle> <email>` grava o e-mail e imprime um link de "definir senha" (o mesmo de "esqueci a senha", 1 h, uso único).
- **Papéis**: `user`, `author`, `editor` (notícias, guias, revisão e moderação) e `admin` (também fraude, jogos, robôs, feeds e usuários). No seed, `lucas` é admin, `Fuyushiro` é editor e `Nyx_Vortex` é autor. Quem não tem o papel recebe 404 em `/admin` (no `src/proxy.ts`, antes de renderizar) e as Server Actions conferem o papel de novo.
- **Conta e LGPD** (`/conta`): perfil, privacidade, exportação dos dados (`/conta/exportar`) e exclusão da conta.

## Robôs (API de conteúdo)

Robôs criam notícias e guias pela API `/api/v1` (documentação em `/desenvolvedores` e `../docs/robos.md`, OpenAPI em `/api/v1/openapi.json`).

1. Um admin cria a chave em `/admin/robos` (nome + escopos `articles:write`, `guides:write`, `publish`). O segredo `tk_live_…` aparece uma vez só; o banco guarda apenas o hash.
2. O robô envia `Authorization: Bearer tk_live_…` e um `Idempotency-Key` por conteúdo. Repetir a mesma chave com o mesmo corpo devolve a mesma resposta sem duplicar; com outro corpo, 409.
3. Sem o escopo `publish`, o conteúdo entra em `/admin/revisao`; um editor revisa e publica, e a notícia passa a mostrar "Gerado por robô · revisado pela redação".

Corpo malformado, HTML, imagem `http:`/`javascript:`, jogo inexistente ou campo desconhecido voltam 4xx com o caminho do campo em JSON Pointer (`/blocks/1/url`). Limite: 60 requisições por minuto por chave.

## Variáveis de ambiente

Copie `.env.example` para `.env`. Em desenvolvimento todas as obrigatórias têm valor padrão. Em produção, `SESSION_SECRET` e `CRON_SECRET` precisam estar definidas (o app não sobe sem elas); defina também `DATABASE_URL` e `APP_URL`, que têm padrões apontando para o ambiente local.

| Variável | Produção | O que faz |
| --- | --- | --- |
| `DATABASE_URL` | obrigatória | Conexão Postgres. Padrão local: `postgresql://gamelog:gamelog@localhost:5433/gamelog`. |
| `SESSION_SECRET` | obrigatória | Segredo (>= 32 caracteres) que assina o cookie de sessão. |
| `CRON_SECRET` | obrigatória | Token Bearer exigido pelos endpoints de cron. |
| `APP_URL` | obrigatória | URL pública do app (ex.: `https://tralked.exemplo.com`). Usada em redirects e nos links de definir senha. |
| `STEAM_API_KEY` | opcional | Biblioteca, conquistas e raridade global pela Web API; ao conectar, também confere se os detalhes de jogos estão públicos. A conexão Steam (e o código da reivindicação no Resumo) lê o perfil público com ou sem chave. Também desativa o login de demonstração. |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | opcional | Metadados de jogos (IGDB / Twitch): capa, descrição, gêneros, datas. |
| `RAWG_API_KEY` | opcional | Metadados complementares de jogos (RAWG). |
| `SGDB_API_KEY` | opcional | Artes (capas, banners, ícones) via SteamGridDB. |
| `PSN_NPSSO` | em produção, para a PSN | Cookie NPSSO da **conta de serviço** PlayStation do Tralked (não de usuários). Trocado no servidor por tokens de acesso/refresh, guardados só em memória. API não oficial: pode quebrar. Sem ele, em produção a PSN aparece como "Em breve". |
| `XBOX_OPENXBL_KEY` | em produção, para o Xbox | Chave da OpenXBL (xbl.io) da conta de serviço Xbox do Tralked. API não oficial. Sem ela, em produção o Xbox aparece como "Em breve". |
| `RA_USERNAME` / `RA_API_KEY` | em produção, para o RA | Usuário e chave da Web API oficial do RetroAchievements (conta de serviço). A chave é o que liga a integração (o usuário vai junto quando definido); sem ela, em produção o RetroAchievements aparece como "Em breve". |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | opcional | Login com Google (OAuth, código + PKCE). URI de redirecionamento: `$APP_URL/api/auth/google/callback`. Sem as duas, `/api/auth/google` responde 404 e o botão some. |
| `BLOB_READ_WRITE_TOKEN` | obrigatória para fotos | Token do Vercel Blob, onde ficam as fotos da galeria (cache de 1 dia; a foto removida pela moderação é apagada do Blob). Sem ele, em produção o envio de fotos responde 503 "O envio de fotos está indisponível no momento"; em desenvolvimento as fotos vão para `public/uploads`. |
| `STEAM_MODE` | opcional | `fixture` usa os dados offline em vez das páginas públicas da Steam (testes e e2e usam); para a biblioteca, só vale sem `STEAM_API_KEY`. |
| `PLATFORM_FIXTURES` | só testes | `1` deixa um build de produção usar as fixtures de PSN/Xbox/RA sem as chaves. Nunca em um deploy real. |
| `DEV_MAIL_LOG_FILE` | nunca | Só fora de produção: arquivo onde os links de "definir senha" também são gravados (os e2e leem dali). |

Sem uma chave, a integração correspondente usa fixtures locais (`src/lib/integrations/*/__fixtures__`) **fora de produção**, então o app funciona offline com os dados do seed. Para ligar dados reais, basta preencher a chave no `.env` e reiniciar; as integrações são escolhidas por `hasKey()` em `src/lib/env.ts`. PSN, Xbox e RetroAchievements **nunca** usam fixtures com `NODE_ENV=production` (`src/lib/integrations/availability.ts`): sem a chave, a fábrica do cliente recusa (`PlatformNotConfiguredError`), a linha da plataforma em `/conta/conexoes` aparece como "Em breve" (campo desabilitado) e o cron pula a plataforma. Só `PLATFORM_FIXTURES=1` (modo de teste explícito) libera as fixtures num build de produção.

A Steam é a exceção: sem `STEAM_API_KEY` ela usa as páginas públicas da comunidade (`src/lib/integrations/steam/community.ts`): perfil e conquistas de perfis públicos em XML e a raridade global, sem chave. A lista de jogos de um perfil exige login na Steam, então a sincronização sonda os jogos do catálogo, um por um, com no máximo uma requisição a cada 1,2 s por domínio: cada sincronização sonda o que cabe em 45 s (o ponto de partida gira pelo catálogo a cada 2 minutos, então sincronizações seguidas cobrem o catálogo todo), para depois de 5 falhas seguidas, e só volta aos jogos que já estão na biblioteca uma vez por semana ou quando os dados do jogo mudam. A importação por script sonda o catálogo inteiro. Com `STEAM_MODE=fixture` tudo fica offline.

## Dados reais da Steam (sem chave)

Dois scripts gravam dados reais no banco indicado em `DATABASE_URL`, que é obrigatória (eles se recusam a gravar no banco `gamelog`). Os dois só inserem e atualizam, nunca apagam. Cada execução deixa um log em `scripts/.logs/`.

```bash
# 1. Catálogo: os N jogos com conquistas mais populares do SteamSpy (tops + página dos mais possuídos), ficha da loja em pt-BR,
#    capa/hero/logo/cabeçalho/screenshots/trailers (links para o CDN da Steam, nada é baixado),
#    conquistas com raridade global e habilidades pelas tags. Pode ser retomado: pula jogos completos.
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_dev pnpm catalog:bootstrap --limit 300

# 2. Perfis públicos: cria/atualiza o usuário como um login Steam faria e sincroniza sondando o catálogo.
DATABASE_URL=... pnpm steam:import 76561198012210783 --admin --psn MrDead_   # dono: admin, Steam verificada, PSN pendente
DATABASE_URL=... pnpm steam:import diguzzz                                    # vanity ou SteamID64; conta não verificada
```

Um perfil importado não tem e-mail nem senha: quem reivindicar essa Steam (código no Resumo) numa conta nova recupera esse mesmo usuário (veja "Contas antigas" acima), ou o admin usa `pnpm user:invite`.

### PSN e Xbox pendentes

`--psn <onlineId>` cria um `LinkedAccount` PSN **pendente** (inativo: sem `linkedAt`, com `externalId` provisório `pending:<onlineId>`). A PSN não tem API pública: para ativar, crie uma conta PSN de serviço dedicada ao Tralked (nunca a de um usuário), entre nela em `https://www.playstation.com`, copie o `npsso` de `https://ca.account.sony.com/api/v1/ssocookie` e defina `PSN_NPSSO` no `.env` do servidor. Depois o dono informa o ID online no campo PlayStation de `/conta/conexoes` e salva, o que grava o `accountId` real. O Xbox também precisa de um provedor com credencial (`XBOX_OPENXBL_KEY`); até lá aparece como "Em breve" em produção.

## Cron

Sete jobs, cada um limitado a uma quantidade fixa de itens por execução. Chame com `GET` e o header `Authorization: Bearer $CRON_SECRET`:

| Endpoint | Faz |
| --- | --- |
| `/api/cron/catalog` | Sincroniza o catálogo de jogos e metadados. |
| `/api/cron/rarity` | Atualiza a raridade global das conquistas. |
| `/api/cron/users` | Ressincroniza até 50 usuários Steam por execução (os mais antigos primeiro), com limite de 50 s para a execução toda: ninguém começa depois do prazo e a sondagem do catálogo de cada usuário usa só o tempo que sobra (no máximo 45 s). |
| `/api/cron/platforms` | Ressincroniza até 5 contas PSN, Xbox e RetroAchievements verificadas por execução (as mais antigas primeiro), lendo só os jogos com conquistas novas e retomando de onde parou (limite de 50 s). |
| `/api/cron/media` | Busca vídeos, screenshots e artworks (IGDB) e capa/hero/logo (SteamGridDB) de jogos ainda sem mídia oficial. |
| `/api/cron/news` | Lê os feeds RSS ativos e guarda título, link, fonte e data das notícias que citam um jogo do catálogo. |
| `/api/cron/notifications` | Diário: apaga notificações com mais de 90 dias (o texto delas pode citar outras pessoas, inclusive quem excluiu a conta). |

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://seu-dominio/api/cron/catalog
```

Resposta: `{ "job": "catalog", "processed": N }`. Token inválido retorna 401, job desconhecido retorna 404.

A rota exporta `maxDuration = 300` (o teto da Vercel sem Fluid compute). Cada job cabe com folga: `catalog` 25 jogos, `rarity` 50, `media` 20, `news` os feeds ativos, `notifications` uma exclusão; `users` e `platforms` param em 50 s. O que sobra vai primeiro na execução seguinte.

### Agendamento (pronto para o `vercel.json`)

O repositório ainda não tem `vercel.json` (a configuração de deploy fica para o plano de produção). Os horários sugeridos, em UTC, já estão no formato da chave `crons`; basta colar no `vercel.json` ao configurar o deploy. A Vercel chama cada rota com `GET` e, quando a variável `CRON_SECRET` existe no projeto, envia `Authorization: Bearer $CRON_SECRET` sozinha. No plano Hobby a Vercel só aceita jobs diários: lá, use `0 3 * * *` (ou outro horário diário) para `news`, `platforms` e `users`.

<!-- crons:start -->
```json
{
  "crons": [
    { "path": "/api/cron/news", "schedule": "0 * * * *" },
    { "path": "/api/cron/platforms", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/users", "schedule": "*/30 * * * *" },
    { "path": "/api/cron/catalog", "schedule": "0 3 * * *" },
    { "path": "/api/cron/rarity", "schedule": "30 3 * * *" },
    { "path": "/api/cron/media", "schedule": "0 4 * * *" },
    { "path": "/api/cron/notifications", "schedule": "15 5 * * *" }
  ]
}
```
<!-- crons:end -->

| Job | Quando | Por quê |
| --- | --- | --- |
| `news` | de hora em hora | manchetes externas chegam o dia todo |
| `platforms` | a cada 15 min | cada execução lê só 5 contas PSN/Xbox/RA |
| `users` | a cada 30 min | contas Steam desatualizadas, poucas por vez |
| `catalog`, `rarity`, `media` | 1x por dia, de madrugada (horário de Brasília) | dados que mudam devagar |
| `notifications` | 1x por dia | apaga notificações com mais de 90 dias |

A lista é a mesma de `CRON_SCHEDULES` em `src/lib/cron/schedules.ts`; um teste falha se as duas divergirem ou se algum job ficar sem horário.

## SEO, privacidade e páginas de sistema

- `sitemap.xml` (jogos, guias publicados, notícias publicadas, tópicos visíveis do fórum e páginas fixas) e `robots.txt` (bloqueia `/admin`, `/conta`, `/api`, `/notificacoes` e `/newsletter`) usam `APP_URL` como origem pública: defina a URL de produção também no build, porque os dois arquivos são gerados nele.
- JSON-LD com `src/lib/seo/json-ld.tsx`: `NewsArticle` nas notícias, `HowTo` nos guias e o helper `videoGameJsonLd()` para a página do jogo (`<JsonLd data={videoGameJsonLd(game)} />`). O texto vai escapado (`<`, `>`, `&`), então título de usuário ou robô nunca fecha o `<script>`.
- Imagem padrão de compartilhamento: `src/app/opengraph-image.tsx`, com a fonte Archivo Expanded em `assets/fonts` (licença OFL em `assets/fonts/OFL.txt`).
- `/privacidade`, `/termos` e `/licencas`. O e-mail de contato `contato@tralked.example` é **provisório** (`src/lib/legal/contact.ts`); troque antes do lançamento.
- Banner de cookies: só cookies necessários por padrão; a escolha fica no cookie `tk_consent` (1 ano) e pode ser trocada em `/privacidade#cookies`. Qualquer cookie opcional futuro (medição, anúncios) deve checar `optionalAllowed()` de `src/lib/consent.ts`.
- `AdSlot` (`src/components/ui/AdSlot.tsx`): reserva o espaço do anúncio, marcado "Publicidade", sem script de terceiros. Fica na página de notícia.
- Newsletter com confirmação dupla: o formulário grava `NewsletterSubscriber` sem confirmação. Ainda não há provedor de e-mail: **fora de produção o link de confirmação sai no console do servidor** (`[newsletter] Link de confirmação ...`); em produção o endereço só fica registrado e o formulário diz "Inscrição registrada". O link (`/newsletter/confirmar?email=&token=`) vale 7 dias (token = validade + HMAC do e-mail com `SESSION_SECRET`) e só abre a página: a confirmação é um POST pelo botão "Confirmar inscrição", então leitores de e-mail que pré-abrem links não confirmam nada. Limites em memória por instância: 5 inscrições por IP a cada 10 min e 1 e-mail por endereço a cada 10 min. Futuro: provedor por env (`EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`), ligado em `deliver()` de `src/lib/newsletter/subscribe.ts`.
- `Article.comments` (contagem nos cards e no topo da notícia) é recontado a cada comentário criado, apagado pelo autor ou ocultado/removido/restaurado pela moderação. Para consertar contadores antigos: `DATABASE_URL=... pnpm comments:recount` (só atualiza os que divergem; o seed também reconta).
- Notificações: sino no topo (não lidas + as 8 últimas, "marcar todas como lidas") e `/notificacoes` com paginação. Cada notificação vive 90 dias (cron `notifications`).

## Scripts

| Script | Descrição |
| --- | --- |
| `pnpm dev` | Servidor de desenvolvimento. |
| `pnpm build` / `pnpm start` | Build e servidor de produção. |
| `pnpm lint` | ESLint. |
| `pnpm test` | Vitest (todas as suítes). Exige `DATABASE_URL` de um banco de teste; veja abaixo. |
| `pnpm test:db` | Apenas a suíte de conexão com o banco (mesma exigência). |
| `pnpm db:up` | `docker compose up -d` (Postgres). |
| `pnpm db:migrate` | `prisma migrate dev`. |
| `pnpm db:seed` | Popula o banco com dados de exemplo. |
| `pnpm db:generate` | `prisma generate` (também roda no `postinstall`). |
| `pnpm catalog:bootstrap` | Catálogo real da Steam (`--limit N` jogos populares, `--concurrency N`, `--only-top`). Exige `DATABASE_URL`. |
| `pnpm comments:recount` | Reconta `Article.comments` pelos comentários visíveis. Exige `DATABASE_URL`. |
| `pnpm steam:import` | Importa um perfil Steam público (`<id64\|vanity> [--admin] [--verified] [--psn <onlineId>]`). Exige `DATABASE_URL`. |
| `pnpm user:invite` | `<handle> <email>`: grava o e-mail de login de uma conta e imprime um link de "definir senha" (1 h, uso único; só no terminal). Exige `DATABASE_URL`; o link usa `APP_URL`. |
| `pnpm e2e` | Playwright + axe contra o build de produção (`pnpm build && pnpm start -p 3200`): rotas públicas. |
| `pnpm e2e:dev` | Playwright + axe contra `next dev -p 3200`: inclui as rotas que exigem login de demonstração. |
| `pnpm e2e:screens` | Screenshots de todas as rotas (1440×900 e 390×844) em `e2e/__screens__/` (ignorado pelo controle de versão). |

## Testes (Vitest)

As suítes do projeto `node` (`src/**/*.test.ts`) gravam no Postgres: criam e apagam chaves, notícias, guias e comentários. Por isso rodam só contra um banco dedicado a testes. `vitest.db-guard.ts` interrompe a execução com um erro claro quando `DATABASE_URL` não está definida ou aponta para `gamelog` (o banco padrão) ou `gamelog_dev` (o banco do servidor de desenvolvimento). O Vitest não lê `.env` nem `.env.local`, então passe a URL na mesma linha do comando:

```bash
docker exec gamelog-db createdb -U gamelog gamelog_test
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm db:seed
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm test
```

No PowerShell: `$env:DATABASE_URL='postgresql://gamelog:gamelog@localhost:5433/gamelog_test'; pnpm test`.

## Testes e2e (Playwright + axe)

Instale o navegador uma vez: `pnpm exec playwright install chromium`.

Os testes sobem o próprio servidor na porta **3200** (outra com `E2E_PORT`, para rodar worktrees em paralelo) e usam um banco só deles, nunca o do servidor de desenvolvimento. O contexto do navegador já leva o cookie `tk_consent`, para o banner de cookies não cobrir a página; `e2e/system.spec.ts` testa o banner com um visitante novo e a home sem JavaScript. Crie e popule o banco e, se quiser outro nome, exporte a URL:

```bash
docker exec gamelog-db psql -U gamelog -d postgres -c "CREATE DATABASE gamelog_e2e"
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e pnpm exec prisma migrate deploy
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e pnpm db:seed
export E2E_DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e   # padrão se omitido
pnpm e2e
```

Dois modos, porque o login de demonstração (`/api/auth/demo`) não existe em produção e isso não é afrouxado:

- `pnpm e2e`: `pnpm build && pnpm start -p 3200`. Valida o que vai para produção; rotas marcadas `auth` são puladas.
- `pnpm e2e:dev` e `pnpm e2e:screens`: `next dev -p 3200`. `loginAsDemo(page)` (em `e2e/helpers.ts`) funciona e as rotas com login rodam.

`e2e/routes.ts` exporta `ROUTES`, a lista central validada por smoke (status 200), screenshots e axe (sem violações `serious`/`critical`). Toda página nova deve ser acrescentada ali.

`e2e/flows.spec.ts` cobre os fluxos críticos nos dois modos: robô cria notícia com chave feita em `/admin/robos` e um editor publica; payloads malformados e repetição de `Idempotency-Key`; foto com tipo falso, visitante e outra origem recusados; comentário, curtida, resposta no fórum e "Resolveu"; fraude confirmada anula XP e recalcula o nível; 404 em `/admin` e Server Actions recusadas para quem não tem o papel; newsletter com confirmação dupla. `loginAs(page, handle)` (em `e2e/helpers.ts`) assina um cookie de sessão com o segredo do servidor de e2e, então esses fluxos agem como qualquer usuário do seed também no build de produção. A configuração recusa `E2E_DATABASE_URL` apontando para `gamelog` ou `gamelog_dev`.

`e2e/auth.spec.ts` cobre a conta do Tralked nos dois modos: visitante em `/jogador/me` vai para `/entrar`; cadastro cai em Conexões; sair e entrar; senha errada e e-mail desconhecido com a mesma mensagem; "esqueci a senha" (mesma resposta para qualquer e-mail; o link é lido de `DEV_MAIL_LOG_FILE`, que a configuração aponta para um arquivo temporário; no modo prod ele não é gravado e o teste é pulado) e link de uso único. Contas criadas ali começam com `e2e_` e são apagadas no início. O cadastro aceita 5 contas por IP por hora: rode a suíte uma vez por servidor.

`e2e/connections.spec.ts` cobre `/conta/conexoes`: no modo dev, vários campos salvos de uma vez (Steam privada recusada com a ajuda de privacidade; depois Steam, PSN, Xbox e RA conectadas sem código, "não verificada", e importadas em segundo plano), conta já em outro perfil recusada e reivindicada com o código (a conta passa, o perfil anterior é notificado), Steam de conta antiga recusada ao digitar e recuperada só pela reivindicação (`Morrigan77`), e esvaziar um campo pede confirmação (cancelar, Esc, confirmar); com axe no estado de reivindicação e com o diálogo aberto. No build de produção (sem as chaves e sem `PLATFORM_FIXTURES`), PSN/Xbox/RA aparecem "Em breve". O teste grava no banco o código que o perfil da fixture mostra, como se a pessoa o tivesse colado. Contas criadas ali começam com `e2c_` e são apagadas no início.

## Validação completa

Antes de entregar, rode na pasta `app/` (com um banco de teste próprio):

```bash
pnpm lint
pnpm exec next typegen && pnpm exec tsc --noEmit   # typegen gera os tipos PageProps/LayoutProps das rotas
DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test pnpm test
pnpm build
E2E_DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e pnpm e2e       # build de produção
E2E_DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_e2e pnpm e2e:dev   # inclui rotas logadas e screenshots
```

Revisão visual: as screenshots ficam em `e2e/__screens__/` (1440×900 e 390×844). O detector do skill `impeccable` roda nos arquivos (`DO_NOT_TRACK=1 npx impeccable detect src`) e nas páginas de um servidor no ar (`npx impeccable detect http://localhost:PORTA/`). Os rótulos mono de 10–10,5 px (chips de plataforma, categorias) e a etiqueta do selo do jogo são da identidade aprovada (handoff + `../preview/`) e ficam como estão.

## Estrutura

```
prisma/               schema, migrations e seed
src/app/              rotas (App Router)
  /                   home com notícias, ranking e missão diária
  jogos/[slug]        página do jogo e /guia (guia 100% com votos)
  jogador/[handle]    perfil público; /jogador/me redireciona para o seu
  highscores          ranking por habilidade (?skill=...)
  familia             modo família e convites
  noticias/[slug]     artigos
  desenvolvedores     documentação da API para robôs (também em ../docs/robos.md)
  admin               painel da redação (editor/admin): notícias e guias em blocos, fila de revisão,
                      moderação, fraude, jogos, chaves de robô, feeds e papéis (só admin nos 5 últimos)
  api/v1              API para robôs: notícias, guias, busca de jogos, OpenAPI e JSON Schemas
  entrar, cadastrar   login e cadastro com e-mail + senha; esqueci-senha e redefinir-senha
  api/auth            login Google, demo e logout
  api/cron/[job]      jobs de sincronização
src/components/       componentes de UI
src/lib/
  engine/             regras puras: XP, vocação, habilidades, streak, missões, antifraude
  integrations/       clientes Steam, IGDB, RAWG, SteamGridDB, PSN, Xbox (OpenXBL), RetroAchievements e RSS (com fixtures)
  sync/               sincronização de catálogo, usuários Steam, contas PSN/Xbox/RA, mídia e notícias externas
  accounts/           conexões de Steam/PSN/Xbox/RA: connect.ts (salvar sem código), link.ts (reivindicar
                      com código, desvincular), steam-link.ts (Steam e contas antigas) + Server Actions
  progression/       recálculo de XP/habilidades a partir do ledger e chaves de período
  queries/            consultas ao banco usadas pelas páginas
  auth/               sessão (jose), e-mail + senha (scrypt), limites de tentativas, links de definir senha,
                      login Google (OAuth + PKCE)
  family/             regras do modo família
  guide/              votos nos passos dos guias
  api/                API para robôs: chaves (hash SHA-256), escopos, limite de 60 req/min por chave
                      (em memória: com várias instâncias cada uma conta à parte), idempotência e erros
  admin/              regras do admin: acesso por papel, CMS, moderação (anula XP ao remover), fraude
src/proxy.ts          /admin responde 404 de verdade a quem não é da redação (as páginas e as
                      Server Actions conferem o papel de novo)
```

## Notas

- `next build` precisa do banco acessível: as páginas dinâmicas (`/jogos/[slug]`, `/noticias/[slug]`, `/jogador/[handle]`) usam `generateStaticParams`, que consulta o Postgres. Suba e popule o banco antes (`pnpm db:up && pnpm db:seed`).
- As suítes de teste que usam o banco (`pnpm test`) também precisam do Postgres no ar e das migrations aplicadas.
- Admin: entre como `lucas` (`/entrar` com as credenciais de desenvolvimento do seed, ou `/api/auth/demo`; o seed dá papel admin) e abra `/admin`. Papéis: `editor` cuida de notícias, guias, revisão e moderação; `admin` também de fraude, jogos, robôs, feeds e usuários. Ninguém muda o próprio papel.
- O projeto usa Next.js 16 com Cache Components; veja `AGENTS.md` antes de alterar convenções do framework.
- Emulador web (SNES/PS1 no navegador): planejado (`../docs/superpowers/specs/2026-10-31-emulador-web-plano-lucas.pdf`), ainda não implementado. Nenhuma rota `/jogar` existe nesta versão.
- E-mail: não há provedor ainda. Em desenvolvimento os links de confirmação da newsletter e de "definir senha" saem no console do servidor; em produção o endereço só é registrado (newsletter) e o link de senha não é enviado: use `pnpm user:invite`.
