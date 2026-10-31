# Tralked Plano 2 — Site completo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o MVP do Plano 1 no site completo Tralked: contas multiplataforma (modelo Exophase), RPG com atributos, página de jogo com a capinha, notícias com faixa em movimento, comunidade (comentários, fórum, galeria), admin/CMS, API para robôs e validação visual completa.

**Architecture:** Mesmo app (`app/`, Next.js 16 App Router + Cache Components, Prisma 7, Postgres). Regras puras em `src/lib/engine`; integrações atrás de interfaces com fixtures; conteúdo editorial em blocos (`src/lib/content`); API pública versionada em `src/app/api/v1`. Uma única migração de schema (Task 2) antes das features.

**Tech Stack:** Next.js 16, TypeScript, Tailwind, Prisma 7 + adapter-pg, Postgres 16, zod, jose, Vitest, Playwright + @axe-core/playwright, sharp (imagens), detector `impeccable` (CLI).

**Spec:** `docs/superpowers/specs/2026-10-31-tralked-plano-2-design.md` (+ base `2026-10-31-gamelog-design.md`). Visual aprovado: `preview/tralked-jogo.html` (página do jogo, capinha, faixa, abas) e `preview/index.html` (resto).

## Global Constraints

- Nome **Tralked** em toda UI, metadata, README e e-mails. Logo: `TRAL` + `K` em `var(--acc)` + `ED`, símbolo Badge com ✓.
- Tokens visuais do handoff (já em `app/src/app/globals.css`); nada de cores soltas fora dos tokens.
- UI em pt-BR; código e commits em inglês; commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nenhuma página chama API externa na renderização; dados vêm do banco (sync em segundo plano).
- O app roda 100% sem chaves (fixtures + seed). Chaves reais só por env.
- Nunca pedir senha ou token de sessão ao usuário. Nunca renderizar HTML cru vindo de usuário, robô ou API.
- Cada mutação (Server Action / route handler) verifica sessão e papel; Server Actions validam argumentos com zod.
- Acessibilidade: foco visível, navegação por teclado, `prefers-reduced-motion` respeitado em toda animação, axe sem violações `serious`/`critical`.
- Páginas públicas de conteúdo (notícia, jogo, guia, tópico do fórum) com 404 real, `generateMetadata` e dados públicos em cache (`"use cache"` + `cacheTag`), partes por usuário em ilhas dinâmicas.
- Testes que usam o banco: cada worktree usa um banco próprio (`DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_<tarefa>`), criado com `prisma migrate reset --force` + seed; nunca rodar testes contra `gamelog` (é o banco do servidor de dev do Lucas na porta 3000).
- Antes de usar qualquer biblioteca/API (Next 16, Prisma 7, Playwright, sharp, Vercel Blob, Google OAuth, RetroAchievements, PSN, Xbox), consultar a doc atual via Context7 ou web.
- `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` verdes ao fim de cada tarefa.

## Review Focus

1. Robô envia payload malformado, HTML embutido, imagem `http:`/`javascript:`, jogo inexistente ou repete o mesmo `Idempotency-Key` → erro 4xx claro com caminho do campo; repetição devolve o mesmo resultado sem duplicar (Task 9).
2. Usuário tenta vincular PSN/Xbox de outra pessoa (código ausente no perfil, código expirado, conta já vinculada a outro usuário) → recusado com mensagem clara (Task 4).
3. Upload de foto com tipo falso, arquivo gigante, ou usuário sem login; comentário/post vazio ou com HTML → recusado; spam além do limite diário não rende XP (Task 8).
4. Primeira visita à página de um jogo com reduced-motion, sem JS, ou com o usuário já tendo aberto em outro dispositivo → página legível sem animação / animação não se repete (Task 5).
5. Fraude confirmada no admin anula XP já pago e o nível do usuário cai corretamente; usuário sem papel não acessa `/admin` nem as Server Actions dele (Tasks 3, 7).

---

### Task 1: Rebrand Tralked + infraestrutura de validação

**Files:** todos os textos/metadata com "GAMELOG"/"PXN" em `app/src/**`, `app/README.md`, `app/package.json` (name `tralked`); `src/components/brand/Logo.tsx`; `src/components/layout/Header.tsx` (nav completa: Notícias `/`, Jogos `/jogos`, Fórum `/forum`, Galeria `/galeria`, Personagem `/jogador/me`, Highscores `/highscores`, Família `/familia`; menu da conta com Conexões `/conta/conexoes`, Admin `/admin` só para admin/editor, Sair); `playwright.config.ts`, `e2e/smoke.spec.ts`, `e2e/screens.spec.ts` (tira screenshot de cada rota em 1440×900 e 390×844 para `e2e/__screens__/`), `e2e/a11y.spec.ts` (axe), scripts `pnpm e2e`, `pnpm e2e:screens`.
**Interfaces — Produces:** `Header({ user?: { handle; level; role } })`; rotas da nav podem ainda não existir (404 até as tarefas seguintes); helper `e2e/helpers.ts` com `loginAsDemo(page)` (usa `/api/auth/demo`), `ROUTES` (lista central de rotas a validar — as tarefas seguintes acrescentam).
- [ ] Testes: Header renderiza os 7 links e o menu da conta por papel (admin vê Admin; user não). Nenhum "GAMELOG"/"PXN" restante em `app/src` (teste que varre arquivos).
- [ ] Playwright roda contra `pnpm build && pnpm start` em porta 3200 com `DATABASE_URL` próprio; smoke de `/`, `/jogos`, `/jogos/hollow-knight/guia`, `/highscores` = 200.
- [ ] Commit `feat: rebrand to Tralked and add e2e validation harness`.

### Task 2: Schema do Plano 2 (migração única)

**Files:** `prisma/schema.prisma`, uma migração, `prisma/seed.ts` + `prisma/seed-data/*` (dados de exemplo de tudo abaixo), `src/lib/db.test.ts` (contagens).
**Interfaces — Produces (modelos novos/alterados, nomes exatos):**
- `Platform` enum-string: `steam | psn | xbox | retro`. `LinkedAccount { id, userId, platform, externalId, handle, verifiedAt?, verifyCode?, verifyExpiresAt?, lastSyncAttemptAt?, lastSyncedAt?, @@unique([platform, externalId]), @@unique([userId, platform]) }`. `User` ganha `googleSub? @unique`, `email?`, `bio?`, `despertarShownAt?`. Steam continua em `User.steamId` e também ganha linha em LinkedAccount (seed migra).
- `GamePlatformLink { gameId, platform, externalId, @@id([platform, externalId]) }`; `Achievement` ganha `platform` (default `steam`), `trophyTier?` (`bronze|silver|gold|platinum`), `points?` (gamerscore/RA points), `hardcore Boolean default false`; `UserGame` ganha `platform` na chave (`@@id([userId, gameId, platform])`, migrar dados existentes como steam).
- `XpLedgerEntry` ganha `voidedAt?`, `platform?`. `AttributeProgress { userId, attribute, level, points, @@id([userId, attribute]) }` com atributos `vigor|precisao|gloria|colecao|exploracao|constancia|sabedoria`.
- `GameMedia { id, gameId, kind (video|screenshot|artwork|cover|hero|logo), url?, youtubeId?, width?, height?, source, order }`; `Game` ganha `aliases String[]`, `developer?`, `publisher?`, `summary` já existe.
- `GameOpen { userId, gameId, openedAt, @@id([userId, gameId]) }`.
- `Article` ganha `status (draft|review|published|archived)`, `blocks Json` (ContentBlock[]), `excerpt?`, `games ArticleGame[]` (n:n, mantém `gameId` legado), `source? (editorial|bot)`, `botKeyId?`, `scheduledAt?`. `ExternalNews { id, gameId?, title, url @unique, source, publishedAt, fetchedAt }`, `NewsFeed { id, name, url @unique, active }`.
- `Guide` ganha `blocks Json?` (corpo livre opcional em blocos), `source?`, `botKeyId?`; `GuideVersion { id, guideId, version, snapshot Json, authorId?, createdAt }`.
- `Comment { id, authorId?, targetType (article|guide|photo|thread), targetId, body, status (visible|hidden|removed), createdAt, editedAt? }` (+ índice por alvo), `Report { id, reporterId?, targetType, targetId, reason, status (open|resolved|dismissed), createdAt, resolvedById? }`.
- `ForumCategory { id, slug @unique, name, description, order }`, `ForumThread { id, categoryId?, gameId?, authorId?, title, slug, status, pinned, solvedPostId?, createdAt, lastPostAt }`, `ForumPost { id, threadId, authorId?, body, createdAt, editedAt?, status }`.
- `Photo { id, authorId?, gameId?, url, width, height, caption?, status, createdAt, likeCount }`, `PhotoLike { userId, photoId, @@id }`.
- `ApiKey { id, name, prefix, hash @unique, scopes String[], createdById?, createdAt, lastUsedAt?, revokedAt? }`, `IngestionLog { id, keyId, idempotencyKey, kind (article|guide), status (created|updated|rejected), resultId?, error Json?, createdAt, @@unique([keyId, idempotencyKey]) }`.
- `Notification { id, userId, kind, title, body?, href?, readAt?, createdAt }`.
- Todas as relações com User: conteúdo autoral `SetNull`, dados pessoais `Cascade` (LGPD).
- Seed: contas vinculadas de exemplo (lucas: steam+psn+xbox+retro verificadas), troféus PSN com tiers e conquistas Xbox com gamerscore para 3 jogos, mídia de exemplo (URLs vazias + fonte "fixture" — a UI usa arte gerada quando `url` é nula), 10 notícias convertidas para `blocks`, 6 ExternalNews de HK, 3 categorias e 6 tópicos de fórum, 12 fotos (url nula → arte gerada), comentários, 1 ApiKey de exemplo **sem segredo utilizável** (hash de valor aleatório descartado), notificações.
- [ ] Testes de banco: contagens do seed; deletar usuário mantém conteúdo autoral; unicidades de LinkedAccount; idempotência do seed. Commit `feat: plan 2 schema and seed`.

### Task 3: Motor RPG v2 (puro) + recompute

**Files:** `src/lib/engine/attributes.ts`, `src/lib/engine/trophies.ts`, `src/lib/engine/despertar.ts` + testes; `src/lib/progression/recompute.ts` (atributos, voided), testes.
**Interfaces — Produces:**
- `trophyTierFromRarity(pct: number | null): 'bronze'|'silver'|'gold'|'platinum'` (≤5 gold, ≤20 silver, resto bronze; platinum só nativo/100%); `gloryPoints(tier)` = bronze 1, silver 2, gold 5, platinum 15.
- `xpForPlatformAchievement({ platform, globalPct, points, trophyTier, hardcore })`: base `xpForAchievement(globalPct)`; Xbox com `points` → `max(base, points * 120)`; PSN sem pct → por tier (bronze 2.000, silver 4.000, gold 9.000, platinum 25.000); RA hardcore ×1,25.
- `ATTRIBUTES` (7 ids, nomes PT: Vigor, Precisão, Glória, Coleção, Exploração, Constância, Sabedoria); `attributePoints(input)` com fontes: vigor = `round(40 * log2(1 + horas))` acumulado por jogo; precisao = 30 por conquista ≤5% (+15 se hardcore); gloria = soma `gloryPoints`×10; colecao = 250 por jogo 100%; exploracao = 20 por jogo com ≥1 conquista + 60 por gênero distinto; constancia = 15 por dia ativo + 5×melhor sequência; sabedoria = pontos de skill `sabio` + 40 por resposta "Resolveu" + 100 por guia publicado. `attributeLevel(points) = floor(sqrt(points / 25)) + 1`.
- `despertarSteps(levelBefore, levelAfter): number[]` (níveis intermediários a mostrar, máx. 12 passos, sempre inclui o final).
- recompute: ignora entradas com `voidedAt`; calcula e grava `AttributeProgress`; `voidFraudEntries(userId, achievementIds)` anula e recalcula.
- [ ] Testes com valores exatos para cada função; recompute reproduz lucas (nível 47) e gera atributos; anular entradas baixa o XP. Commit `feat: attributes, trophies and ledger voiding`.

### Task 4: Integrações v2 (PSN, Xbox, RetroAchievements, Google, mídia IGDB, notícias externas) + vinculação

**Files:** `src/lib/integrations/{psn,xbox,retro}/{types,client,fixture,index}.ts`, `src/lib/integrations/igdb` (+ `getMedia`), `src/lib/integrations/rss`, `src/lib/auth/google.ts` + rotas `/api/auth/google`, `/api/auth/google/callback`, `src/lib/accounts/link.ts` (fluxo de verificação), `src/lib/sync/{platform-user,media,external-news}.ts`, cron jobs novos (`media`, `news`, `platforms`), testes.
**Interfaces — Produces:**
- `PsnApi { findProfile(onlineId) → {accountId, onlineId, aboutMe, avatarUrl, isPrivate}; getTitles(accountId) → {npTitleId, name, progress, trophyCounts, lastPlayed}[]; getTrophies(accountId, npTitleId) → {trophyId, name, tier, earned, earnedAt, rarityPct}[] }` (cliente real usa conta de serviço via `PSN_NPSSO` env, trocando por access/refresh token server-side; fixture sem env).
- `XboxApi { findProfile(gamertag) → {xuid, gamertag, bio, avatarUrl}; getTitles(xuid); getAchievements(xuid, titleId) → {id, name, gamerscore, unlockedAt, rarityPct}[] }` (env `XBOX_*` para o provedor escolhido após consulta à doc; fixture sem env).
- `RetroApi` (oficial, `RA_API_KEY`): perfil (motto), progresso por jogo, conquistas com hardcore.
- `startLink(userId, platform, handle) → { code, expiresAt }` (código `TRK-XXXXXX`, 30 min); `confirmLink(userId, platform) → ok | { reason: 'code_missing'|'expired'|'taken'|'private'|'not_found' }`; `unlink`.
- Google OAuth (Authorization Code + PKCE, `GOOGLE_CLIENT_ID/SECRET`): cria usuário leitor ou vincula a usuário logado; sem env → rota retorna 404 e a UI esconde o botão.
- Sync por plataforma grava UserGame/UserAchievement/ledger com `platform` e chama recompute; mapeia jogo da plataforma para `Game` (por `GamePlatformLink`, nome normalizado, IGDB externals).
- `syncGameMedia(gameId)` (IGDB videos/screenshots/artworks + SGDB) e `syncExternalNews()` (RSS ativos, casa por nome/aliases, guarda título/link/fonte/data).
- [ ] Testes com fetch mockado para cada cliente; fluxo de vinculação cobre todos os `reason`; sync PSN de fixture gera XP e troféus; nada vaza segredos em erros. Commit `feat: multi-platform accounts, media and external news`.

### Task 5: Página do jogo v2 (capinha + perfil dinâmico)

**Files:** `src/app/jogos/[slug]/page.tsx` (reescrita), `src/components/game/{CaseIntro,Disc,DiscProgress,BookletSpread,AttributesGained,MediaRail,ShotsRail,FamilyPlayers,SimilarShelf,GameArt}.tsx`, `src/components/news/{NewsWire,WireCard,NewsTabs}.tsx` (componentes compartilhados com a Task 6 — esta tarefa os cria), Server Action `markOpened(gameId)`, `src/lib/queries/game-profile.ts`, testes de componente e de query; e2e da abertura.
**Interfaces — Produces:** `<NewsWire items: WireItem[] />`, `type WireItem = { id, href, variant: 'paper'|'block'|'newp'|'portrait'|'dark', kicker, title, source, when, imageUrl?: string|null, seed: number, items?: {label, date}[] }`; `<NewsTabs tabs: {id,label,stories}[] />`; `<GameArt seed hues imageUrl? />` (usa imagem real quando houver, senão arte gerada em canvas como na prévia); `getGameProfile(slug)` (cacheado) e `getGameProfileForUser(slug, userId)`.
- Reproduzir fielmente `preview/tralked-jogo.html` (estrutura, tempos, sons opcionais com mudo, iridescência, platina dourada, faixa, abas), agora com dados reais: progresso consolidado de todas as plataformas, troféus por tier, atributos ganhos no jogo, mídia (`GameMedia`), notícias (Articles do jogo + ExternalNews), galeria (Photo do jogo), família, jogos parecidos (mesmas skills).
- Primeira abertura: logado → `GameOpen`; deslogado → localStorage. Página legível e indexável sem JS (a intro é só uma camada por cima, renderizada no cliente).
- [ ] Testes: query consolida plataformas; markOpened idempotente e exige login; e2e: primeira visita mostra a intro, "Pular" revela, segunda visita não mostra, reduced-motion não mostra. Commit `feat: game profile page with case opening`.

### Task 6: Notícias v2

**Files:** `src/app/page.tsx` (home: faixa "Em circulação" + destaques + abas + lateral), `src/app/noticias/page.tsx` (índice: faixa + abas por categoria + paginação `?pagina=`), `src/app/noticias/[slug]/page.tsx` (renderiza `blocks`, jogos relacionados, comentários), `src/lib/content/{schema,render}.ts(x)` (ContentBlock zod + renderizador `<Blocks blocks />`), testes.
**Interfaces — Consumes:** `NewsWire`, `NewsTabs` (Task 5 — se ainda não existirem no branch, criar exatamente com as interfaces da Task 5). **Produces:** `contentBlocksSchema` (zod, estrito, conforme spec), `<Blocks blocks />`, `inlineMarkup(text)` seguro.
- [ ] Testes: schema rejeita HTML, `javascript:`, imagem sem alt/crédito; renderizador gera a marcação esperada; índice pagina e filtra por categoria; artigo inexistente → 404 real. Commit `feat: news wire, tabs and block content`.

### Task 7: Admin e CMS

**Files:** `src/app/admin/**` (layout com checagem de papel, dashboard, `noticias` lista/criar/editar, `guias` lista/editar, `moderacao` (comentários, fotos, fórum, denúncias), `fraude` (casos suspeitos → confirmar anula XP / liberar), `jogos` (override de gêneros/aliases), `robos` (chaves de API: criar mostra o segredo uma vez, revogar; log de ingestão), `feeds` (NewsFeed)), `src/lib/admin/*.ts` + testes.
- Editor de notícia/guia: formulário estruturado com lista de blocos (adicionar/reordenar/remover, pré-visualização com `<Blocks>`), status (rascunho/revisão/publicado), jogos relacionados. Fila "Revisão" mostra conteúdo de robôs pendente.
- [ ] Testes: usuário comum recebe 404 em `/admin` e erro nas actions; criar chave guarda só hash; revogar bloqueia uso; confirmar fraude anula ledger e baixa nível. Commit `feat: admin panel and CMS`.

### Task 8: Comunidade — comentários, galeria, fórum

**Files:** `src/app/galeria/page.tsx`, `src/app/galeria/[id]/page.tsx`, `src/app/forum/page.tsx`, `src/app/forum/[categoria]/page.tsx`, `src/app/forum/t/[id]/page.tsx`, `src/components/community/{Comments,PhotoGrid,PhotoCard,UploadPhoto,ForumList,ThreadView,ReportButton}.tsx`, `src/lib/community/*.ts`, `src/lib/storage/{index,local,blob}.ts`, testes.
- Comentários em notícias, guias, fotos e tópicos (paginados, denúncia, editar/apagar próprio, 1–2.000 caracteres, texto puro com links seguros). Galeria: grade estilo Instagram, filtro por jogo, upload (sharp: valida tipo real, reencoda WebP, máx. 2048 px), curtir, foto da semana; XP: 50 por foto aprovada, máx. 3/dia. Fórum: categorias + tópicos por jogo, responder, marcar "Resolveu" (autor do tópico) → ledger `forum_solved` 40 pts Sabedoria; rate limit simples por usuário.
- [ ] Testes: tipos falsos recusados; sem login recusado; limite diário de XP; só o autor marca resolvido; denúncia cria Report. Commit `feat: comments, gallery and forum`.

### Task 9: API para robôs

**Files:** `src/app/api/v1/{articles,guides}/route.ts`, `.../[id]/route.ts` (GET status, PATCH), `src/app/api/v1/games/route.ts` (busca para robôs resolverem jogos), `src/app/api/v1/openapi.json/route.ts`, `src/lib/api/{auth,rate-limit,idempotency,errors}.ts`, `src/lib/content/guide-schema.ts` (payload de guia: ficha, overview, warnings, steps[{title,hours,body(blocks),achievements[]}], achievementNotes[{apiName,category,spoiler,tip(blocks),steps[]}], collectibles, sources), `src/app/desenvolvedores/page.tsx` (documentação PT com exemplos curl), `docs/robos.md` (guia para quem for escrever os robôs, com exemplos completos de payload), testes.
- Respostas: `201 {id, status, url}`; erros `{error:{code,message,issues:[{path,message}]}}`; 401 sem chave, 403 sem escopo, 409 slug em conflito, 422 validação, 429 limite. Mesmo `Idempotency-Key` + mesmo corpo → mesma resposta; corpo diferente → 409.
- Notícia de robô: `source: bot`, autor "Robô <nome da chave>", selo "Autoria humana" desligado e selo "Gerado por robô · revisado pela redação" quando publicado por editor.
- [ ] Testes de contrato para cada código de status, sanitização, idempotência, escopos, revogação e limite. Commit `feat: bot ingestion API v1`.

### Task 10: Conta, conexões e personagem v2

**Files:** `src/app/conta/conexoes/page.tsx` (cartões Steam/PSN/Xbox/RetroAchievements/Google com estado, passo a passo da verificação com o código e botão "Já colei o código"), `src/app/conta/page.tsx` (bio, privacidade, exportar dados JSON, excluir conta com confirmação digitada), atualização de `/jogador/[handle]` (bloco de atributos estilo janela de skills, badges de plataforma, troféus totais por tier, galeria do jogador, sequência "Despertar" após o primeiro sync), testes.
- [ ] Testes: exportação contém só dados do próprio usuário; exclusão remove dados pessoais e mantém conteúdo autoral anônimo; Despertar mostra uma vez. Commit `feat: account connections and character v2`.

### Task 11: Operação — notificações, SEO, LGPD, páginas de sistema

**Files:** sino de notificações no header (ilha dinâmica) + `/notificacoes`; `src/app/sitemap.ts`, `src/app/robots.ts`, JSON-LD (NewsArticle, VideoGame, HowTo para guias), `opengraph-image` padrão da marca; `src/app/privacidade`, `src/app/termos`; banner de consentimento de cookies (só necessários por padrão); `not-found.tsx` e `error.tsx` com a identidade; componente `AdSlot` (reserva de espaço, marcado "Publicidade"); newsletter persistida (`NewsletterSubscriber`, double opt-in simulado em dev). Testes.
- [ ] Commit `feat: notifications, SEO, privacy and system pages`.

### Task 12: Validação completa

- [ ] `pnpm lint`, `tsc`, `pnpm test`, `pnpm build` verdes.
- [ ] Playwright: smoke + fluxos (login demo, abrir capinha, comentar, curtir foto, responder fórum, vincular conta fixture, admin cria notícia, robô cria notícia via API e editor publica) + screenshots de todas as rotas em desktop e mobile; axe sem `serious`/`critical`.
- [ ] Detector `impeccable` (`DO_NOT_TRACK=1 npx impeccable detect app/src` e nas URLs principais) — corrigir achados relevantes; registrar os ignorados com motivo.
- [ ] Revisão visual das screenshots contra a prévia e o handoff (rubrica: `impeccable` audit/polish/critique); correções.
- [ ] README atualizado (Tralked, contas, robôs, validação). Commit `chore: full validation pass`.
