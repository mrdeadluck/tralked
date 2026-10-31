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

Sem uma chave, a integração correspondente usa fixtures locais (`src/lib/integrations/*/__fixtures__`), então o app funciona offline com os dados do seed. Para ligar dados reais, basta preencher a chave no `.env` e reiniciar; as integrações são escolhidas por `hasKey()` em `src/lib/env.ts`.

## Cron

Três jobs, cada um limitado a uma quantidade fixa de jogos/usuários por execução. Chame com `GET` e o header `Authorization: Bearer $CRON_SECRET`:

| Endpoint | Faz |
| --- | --- |
| `/api/cron/catalog` | Sincroniza o catálogo de jogos e metadados. |
| `/api/cron/rarity` | Atualiza a raridade global das conquistas. |
| `/api/cron/users` | Ressincroniza usuários com dados desatualizados. |

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
| `pnpm test` | Vitest (todas as suítes). |
| `pnpm test:db` | Apenas a suíte de conexão com o banco. |
| `pnpm db:up` | `docker compose up -d` (Postgres). |
| `pnpm db:migrate` | `prisma migrate dev`. |
| `pnpm db:seed` | Popula o banco com dados de exemplo. |
| `pnpm db:generate` | `prisma generate` (também roda no `postinstall`). |
| `pnpm e2e` | Playwright + axe contra o build de produção (`pnpm build && pnpm start -p 3200`): rotas públicas. |
| `pnpm e2e:dev` | Playwright + axe contra `next dev -p 3200`: inclui as rotas que exigem login de demonstração. |
| `pnpm e2e:screens` | Screenshots de todas as rotas (1440×900 e 390×844) em `e2e/__screens__/` (ignorado pelo controle de versão). |

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
  api/auth            login Steam, demo e logout
  api/cron/[job]      jobs de sincronização
src/components/       componentes de UI
src/lib/
  engine/             regras puras: XP, vocação, habilidades, streak, missões, antifraude
  integrations/       clientes Steam, IGDB, RAWG e SteamGridDB (com fixtures)
  sync/               sincronização de catálogo, usuários e vínculo de conta
  progression/       recálculo de XP/habilidades a partir do ledger e chaves de período
  queries/            consultas ao banco usadas pelas páginas
  auth/               sessão (jose), OpenID Steam, upsert de usuário
  family/             regras do modo família
  guide/              votos nos passos dos guias
```

## Notas

- `next build` precisa do banco acessível: as páginas dinâmicas (`/jogos/[slug]`, `/noticias/[slug]`, `/jogador/[handle]`) usam `generateStaticParams`, que consulta o Postgres. Suba e popule o banco antes (`pnpm db:up && pnpm db:seed`).
- As suítes de teste que usam o banco (`pnpm test`) também precisam do Postgres no ar e das migrations aplicadas.
- O projeto usa Next.js 16 com Cache Components; veja `AGENTS.md` antes de alterar convenções do framework.
