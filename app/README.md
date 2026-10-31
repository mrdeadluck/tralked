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

### Login de demonstração

Em desenvolvimento, abra `http://localhost:3000/api/auth/demo`. A rota cria uma sessão como o usuário seed `lucas` e redireciona para `/jogador/lucas`.

A rota só existe fora de produção (`NODE_ENV !== "production"`) e responde 404 quando `STEAM_API_KEY` está configurada, caso em que o login real é feito pela Steam (`/api/auth/steam`).

## Variáveis de ambiente

Copie `.env.example` para `.env`. Em desenvolvimento todas as obrigatórias têm valor padrão. Em produção, `SESSION_SECRET` e `CRON_SECRET` precisam estar definidas (o app não sobe sem elas); defina também `DATABASE_URL` e `APP_URL`, que têm padrões apontando para o ambiente local.

| Variável | Produção | O que faz |
| --- | --- | --- |
| `DATABASE_URL` | obrigatória | Conexão Postgres. Padrão local: `postgresql://gamelog:gamelog@localhost:5433/gamelog`. |
| `SESSION_SECRET` | obrigatória | Segredo (>= 32 caracteres) que assina o cookie de sessão. |
| `CRON_SECRET` | obrigatória | Token Bearer exigido pelos endpoints de cron. |
| `APP_URL` | obrigatória | URL pública do app (ex.: `https://tralked.exemplo.com`). Usada em redirects e no retorno do login Steam. |
| `STEAM_API_KEY` | opcional | Login Steam, biblioteca, conquistas e raridade global. Também desativa o login de demonstração. |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | opcional | Metadados de jogos (IGDB / Twitch): capa, descrição, gêneros, datas. |
| `RAWG_API_KEY` | opcional | Metadados complementares de jogos (RAWG). |
| `SGDB_API_KEY` | opcional | Artes (capas, banners, ícones) via SteamGridDB. |
| `PSN_NPSSO` | opcional | Cookie NPSSO da **conta de serviço** PlayStation do Tralked (não de usuários). Trocado no servidor por tokens de acesso/refresh, guardados só em memória. API não oficial: pode quebrar. |
| `XBOX_OPENXBL_KEY` | opcional | Chave da OpenXBL (xbl.io) da conta de serviço Xbox do Tralked. API não oficial. |
| `RA_USERNAME` / `RA_API_KEY` | opcional | Usuário e chave da Web API oficial do RetroAchievements (conta de serviço). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | opcional | Login com Google (OAuth, código + PKCE). URI de redirecionamento: `$APP_URL/api/auth/google/callback`. Sem as duas, `/api/auth/google` responde 404 e o botão some. |
| `STEAM_MODE` | opcional | Só vale sem `STEAM_API_KEY`: `fixture` usa os dados offline em vez das páginas públicas da Steam (testes e e2e usam). |

Sem uma chave, a integração correspondente usa fixtures locais (`src/lib/integrations/*/__fixtures__`), então o app funciona offline com os dados do seed. Para ligar dados reais, basta preencher a chave no `.env` e reiniciar; as integrações são escolhidas por `hasKey()` em `src/lib/env.ts`.

A Steam é a exceção: sem `STEAM_API_KEY` ela usa as páginas públicas da comunidade (`src/lib/integrations/steam/community.ts`): perfil e conquistas de perfis públicos em XML e a raridade global, sem chave. A lista de jogos de um perfil exige login na Steam, então a sincronização sonda os jogos do catálogo, um por um, com no máximo uma requisição a cada 1,2 s por domínio. Com `STEAM_MODE=fixture` tudo fica offline.

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

O login real pela Steam (`/api/auth/steam`) de um perfil importado cai no mesmo usuário, porque os dois caminhos buscam o usuário pelo SteamID64.

### PSN e Xbox pendentes

`--psn <onlineId>` cria um `LinkedAccount` PSN **pendente** (sem `verifiedAt`, com `externalId` provisório `pending:<onlineId>`). A PSN não tem API pública: para ativar, crie uma conta PSN de serviço dedicada ao Tralked (nunca a de um usuário), entre nela em `https://www.playstation.com`, copie o `npsso` de `https://ca.account.sony.com/api/v1/ssocookie` e defina `PSN_NPSSO` no `.env` do servidor. Depois o dono confirma a vinculação pela tela de contas (código no "Sobre mim" da PSN), o que grava o `accountId` real e a data de verificação. O Xbox também precisa de um provedor com credencial; até lá fica sem vínculo.

## Cron

Sete jobs, cada um limitado a uma quantidade fixa de itens por execução. Chame com `GET` e o header `Authorization: Bearer $CRON_SECRET`:

| Endpoint | Faz |
| --- | --- |
| `/api/cron/catalog` | Sincroniza o catálogo de jogos e metadados. |
| `/api/cron/rarity` | Atualiza a raridade global das conquistas. |
| `/api/cron/users` | Ressincroniza usuários com dados desatualizados. |
| `/api/cron/platforms` | Ressincroniza até 5 contas PSN, Xbox e RetroAchievements verificadas por execução (as mais antigas primeiro), lendo só os jogos com conquistas novas e retomando de onde parou (limite de 50 s). |
| `/api/cron/media` | Busca vídeos, screenshots e artworks (IGDB) e capa/hero/logo (SteamGridDB) de jogos ainda sem mídia oficial. |
| `/api/cron/news` | Lê os feeds RSS ativos e guarda título, link, fonte e data das notícias que citam um jogo do catálogo. |
| `/api/cron/notifications` | Diário: apaga notificações com mais de 90 dias (o texto delas pode citar outras pessoas, inclusive quem excluiu a conta). |

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://seu-dominio/api/cron/catalog
```

Resposta: `{ "job": "catalog", "processed": N }`. Token inválido retorna 401, job desconhecido retorna 404.

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
| `pnpm steam:import` | Importa um perfil Steam público (`<id64\|vanity> [--admin] [--verified] [--psn <onlineId>]`). Exige `DATABASE_URL`. |
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

Os testes sobem o próprio servidor na porta **3200** e usam um banco só deles, nunca o do servidor de desenvolvimento. Crie e popule o banco e, se quiser outro nome, exporte a URL:

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
  api/auth            login Steam, Google, demo e logout
  api/cron/[job]      jobs de sincronização
src/components/       componentes de UI
src/lib/
  engine/             regras puras: XP, vocação, habilidades, streak, missões, antifraude
  integrations/       clientes Steam, IGDB, RAWG, SteamGridDB, PSN, Xbox (OpenXBL), RetroAchievements e RSS (com fixtures)
  sync/               sincronização de catálogo, usuários Steam, contas PSN/Xbox/RA, mídia e notícias externas
  accounts/           vinculação de contas PSN/Xbox/RA por código de verificação (+ Server Actions)
  progression/       recálculo de XP/habilidades a partir do ledger e chaves de período
  queries/            consultas ao banco usadas pelas páginas
  auth/               sessão (jose), OpenID Steam, login Google (OAuth + PKCE), upsert de usuário
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
- Admin: entre como `lucas` (`/api/auth/demo`, só em desenvolvimento; o seed dá papel admin) e abra `/admin`. Papéis: `editor` cuida de notícias, guias, revisão e moderação; `admin` também de fraude, jogos, robôs, feeds e usuários. Ninguém muda o próprio papel.
- O projeto usa Next.js 16 com Cache Components; veja `AGENTS.md` antes de alterar convenções do framework.
