# Unificação de troféus e jogos: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada lista de troféus vira uma versão do jogo. Nada mais colide, o XP segue a regra nova (uma vez por console), a página do jogo e o perfil mostram as versões, a busca filtra exclusivos e "com troféus", os duplicados se juntam com redirecionamento e, por fim, jogos que ninguém tem passam a mostrar a lista de troféus da PSN.

**Architecture:** Duas tabelas novas: `TrophyList` (uma lista de uma plataforma, ligada a um `Game`) e `UserTrophyList` (o progresso do jogador por lista). `Achievement` passa a pertencer a uma lista (`listId`, único por `listId + apiName`). `UserGame` continua sendo a linha por jogo e plataforma (biblioteca, horas), agora com totais somados de todas as listas. O XP de PSN/Xbox/RA deixa de ser montado dentro do sync: uma função única de reconciliação (`settleListXp`) calcula as entradas que a regra quer para um jogo, anula as que sobram e acrescenta as que faltam. A mesma função serve para o sync, para o recálculo dos usuários e para a junção de duplicados. A Steam não muda de lógica: só passa a gravar o `listId`.

**Tech Stack:** Next.js 16 (App Router, `"use cache"`), Prisma 7 + Postgres (Neon), vitest (projeto `node` com banco), TypeScript, GitHub Actions para workers.

**Spec:** `docs/superpowers/specs/2026-11-03-trophy-unification-design.md` (fonte da verdade) + o pedido do Lucas de 05/11 (fases de entrega, critérios de aceite, regras de banco). O executor lê os dois.

## Fatos medidos antes do plano (05/11)

- Produção tem 3 usuários (`lucas`, `diguzz`, `MrDead_`), e cada um tem PSN, Xbox, RA e Steam ligados.
- **PSN:**
  - 31.327 linhas `Achievement`.
  - 129 jogos com mais de uma lista `NPWR…`. São os que colidem.
  - `GamePlatformLink` da PSN guarda listas (`NPWR`, 955) e ids de loja (`CUSA`/`PPSA`, 789) da lista de jogados.
- **Steam:**
  - 460.054 linhas `Achievement` em 7.890 jogos.
  - Todo jogo da Steam já tem `GamePlatformLink(steam, appid)`.
- **Xbox:** 1 jogo com dois `titleId`.
- **Sony (spike com a NPSSO de `.env.chaves`):**
  - `GET /trophy/v1/npCommunicationIds/{id}/trophyGroups[?npServiceName=trophy]` e `…/trophyGroups/all/trophies` respondem para **qualquer** lista, sem conta de jogador. A conta de serviço é nível 1 e não tem jogos.
  - `GET /trophy/v1/users/{accountId}/titles/trophyTitles?npTitleIds=a,b,…` liga `titleId → npCommunicationId`, mas só para a conta de quem jogou (`users/me` volta `[]`).
    - Aceita no máximo **5** ids por pedido (6 dá 400).
    - Um id desconhecido derruba o lote com 404, e aí é preciso repetir um a um.
  - A lista de jogados (`gamelist/v2`) traz `concept.id` e `concept.titleIds`, que juntam todas as regiões e consoles de um jogo. O GTA V tem um conceito só (201930), com 11 ids PS4 + PS5.
  - Varrer ids `NPWR00001_00…NPWR6xxxx_00` por `trophyGroups` funciona (ex.: `NPWR10000_00` = Fairune, PSVITA). É o único caminho para jogos que ninguém no Tralked tem.

## Decisões do plano (o spec deixou para quem constrói)

- **Schema** (uma migration na fase a, outra na c, outra na d):
  ```prisma
  model TrophyList {
    id          String   @id @default(cuid())
    gameId      String
    platform    String   // steam | psn | xbox | retro
    externalId  String   // npCommunicationId | Xbox titleId | Steam appid | RA game id
    /// PSN: console code ("PS4", "PS5", "PS3+PSVITA"); Xbox: "360" | "ONE" | "PC"; Steam: "PC"; RA: console name.
    /// Written once (when null) and never changed by a sync: it is part of the XP keys.
    console     String?
    name        String
    serviceName String?  // PSN: trophy | trophy2
    conceptId   Int?     // PSN concept (played-games list): groups regional lists of one game
    region      String?  // "jp" | "kr" | null (see regionOf)
    trophyCount Int      @default(0)
    createdAt   DateTime @default(now())
    game         Game             @relation(fields: [gameId], references: [id], onDelete: Cascade)
    achievements Achievement[]
    progress     UserTrophyList[]
    @@unique([platform, externalId])
    @@index([gameId, platform])
    @@index([conceptId])
  }
  model UserTrophyList {
    userId        String
    listId        String
    unlockedCount Int
    hardcoreCount Int       @default(0)
    completedAt   DateTime?
    updatedAt     DateTime  @updatedAt
    user User       @relation(fields: [userId], references: [id], onDelete: Cascade)
    list TrophyList @relation(fields: [listId], references: [id], onDelete: Cascade)
    @@id([userId, listId])
    @@index([listId])
  }
  ```
  `Achievement` ganha `listId String?` com relação `onDelete: Cascade`:
  - troca `@@unique([gameId, platform, apiName])` por `@@unique([listId, apiName])` + `@@index([gameId, platform])`;
  - `gameId` e `platform` ficam como cópia (todos os leitores atuais usam esses campos);
  - na fase d, `listId` vira obrigatório.
- **Versão** = `versionKey(list)`:
  - Steam: `"steam"`;
  - PSN: `psn:<console>` (sem console: `psn:<externalId>`);
  - Xbox/RA: `<platform>:<externalId>`.
- **Lista canônica** de uma versão PSN = a de `createdAt` mais antigo (empate: `externalId` crescente).
- **Chaves do ledger** (só PSN/Xbox/RA mudam; a Steam fica como está):
  - `achievement`:
    - PSN: id do `Achievement` de mesmo `apiName` na lista canônica da versão (se a canônica não tiver esse `apiName`, o próprio id);
    - Xbox/RA: o próprio id.
  - `platinum`:
    - PSN: `psn:<console>:<gameId>`;
    - Xbox/RA: `<platform>:<externalId>:<gameId>`;
    - Steam: `gameId` (sem mudança).
  - `platinumGameId(key)` passa a pegar o trecho depois do **último** `:`.
  - O valor pago num troféu regional duplicado é o da lista em que ele foi obtido primeiro (`unlockedAt` mais antigo), e a data é essa.
- **`UserGame` de PSN/Xbox/RA** (uma linha por jogo e plataforma):
  - `unlockedCount` = todos os desbloqueios de todas as listas do jogo naquela plataforma;
  - `completedAt` = a menor `completedAt` entre as `UserTrophyList` daquele jogo/plataforma;
  - horas continuam somadas por jogo e plataforma (spec).
- **Contagem "uma vez por console"** (XP, nível, ranking, atributos, missões): `countedUnlocks()` deduplica desbloqueios PSN por `(gameId, versionKey, apiName)`, ficando com o mais antigo. O "total de troféus" do perfil (`userAchievement.count`) **não** deduplica.
- **Região:**
  - kana ou ideograma → `"jp"` (🇯🇵 Ásia);
  - hangul → `"kr"` (🇰🇷 Ásia);
  - o resto → `null` ("Lista N" pela ordem de criação dentro da versão, e sem rótulo quando a versão tem uma lista só);
  - a China nunca é deduzida, porque um nome só com ideogramas não é inequívoco.
- **Rótulos:**
  - PSN: `PS3`, `Vita`, `PS4`, `PS5`, `PC` unidos por ` · ` (`PS3 · Vita`);
  - Steam: `PC · Steam`;
  - Xbox: `Xbox 360` / `Xbox One/Series` / `Xbox PC` / `Xbox` (sem console);
  - RA: nome do console.
- **Agrupar listas regionais sozinhas:** no sync da PSN, os `titleIds` da lista de jogados ainda não mapeados passam pelo `npTitleIds` (lotes de 5, no máximo 50 ids por sync). A memória fica em `SyncCursor psn-concepts:<linkedAccountId>`. Uma lista desconhecida cujo conceito já tem lista ou `titleId` ligado a um jogo cai nesse jogo, antes de qualquer casamento por nome.
- **Redirecionamento de slug:** `permanentRedirect()` do Next responde **308**, que para o Google vale o mesmo que 301. Para 301 literal, a consulta teria que ir para o `proxy.ts` em toda requisição de `/jogos/*`. Uso 308 e aviso o Lucas no resumo da fase d.
- **Ensaio da junção:** `pg_dump` do Neon restaurado no Docker local (`gamelog_rehearsal`), sem branch da Neon. Não gasta CU e equivale a "rodar numa cópia do banco".
- **Etapa 7 (PSN):**
  - um índice leve `PsnCatalogList` (como `RetroCatalogGame`) preenchido por varredura de ids `NPWR`;
  - os troféus são lidos **sob demanda**, quando a página do jogo abre, como no RA;
  - gravar todos os troféus de ~65 mil listas (~1,5 M linhas) estoura o 1 GB do Neon grátis;
  - só começa com o "sim" do Lucas para a varredura (é uma API não oficial; a conta de serviço corre risco).
- **Etapa 7 (Xbox):** começa com um spike (E1). Se não houver caminho para listar conquistas de um `titleId` sem jogador ou para achar o `titleId` de um jogo do catálogo, a parte Xbox para e o Lucas é avisado.

## Global Constraints

- Steam: nenhuma mudança em `lib/sync/user.ts` além do necessário para compilar. Contagem de `UserAchievement` Steam e soma do XP Steam (ledger `platform IS NULL`, `source IN (achievement, platinum)`) idênticas antes e depois de cada fase. É conferido por `scripts/trophy-lists-snapshot.ts`.
- Visual: grafite + verde-limão, cantos `tk-cut*`, telas densas. Nenhuma cor nova sem perguntar ao Lucas. Mockup (artifact) aprovado **antes** das tarefas de tela B1–B4 e C3.
- Texto da interface em português do Brasil. Rótulos fixos deste plano: "Platinas (contam no XP)", "Listas regionais extras", "Jogos", "Nível", "Só exclusivos", "Só com troféus", "PC · Steam", "Outras edições", "`N` listas · conta 1", "Lista 1", "🇯🇵 Ásia", "🇰🇷 Ásia".
- Worktree `C:\projetos\tralked-trophy-lists`, branch `feat/trophy-lists`, criada a partir de `origin/main`. Não tocar em `C:\projetos\Nova pasta`, `C:\projetos\tralked-robo-guias` nem em `C:\projetos\rg-wt\{t15,t40,t41}`.
- Testes com banco: `DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test`, `pnpm exec prisma migrate deploy` antes. A suíte inteira tem que passar (1.915 hoje, mais as novas), mais `pnpm exec tsc --noEmit` e `pnpm lint`, sempre em `app/`.
- Banco de produção:
  - leitura com `docker exec -e U="$U" gamelog-db psql "$U" …` (`U` = `DATABASE_URL_UNPOOLED` do `.env.local` da raiz);
  - **toda escrita** é precedida de `pg_dump` em `C:\Users\luck_\tralked-backups\` **e** de uma mensagem ao Lucas dizendo exatamente o que muda, esperando o "ok";
  - migrations só por `prisma migrate deploy`, depois do backup;
  - lotes pesados de uma vez, sem deixar o banco acordado à toa.
- Chaves: `PSN_NPSSO`, `XBOX_OPENXBL_KEY` etc. lidas de `C:\projetos\Nova pasta\.env.chaves` por script, sem imprimir o valor.
- Publicação de cada fase:
  - `git merge --no-ff feat/trophy-lists` na `main`, depois `git push`;
  - esperar `gh api repos/mrdeadluck/tralked/commits/<sha>/status` com o contexto "Vercel" em `success`;
  - conferir no site e resumir para o Lucas em português simples.
- Anti-objetivos do spec valem em todas as tarefas:
  - ninguém perde progresso;
  - slug antigo nunca dá 404;
  - comprar em três regiões não sobe ranking;
  - os syncs não voltam ao loop de reler tudo.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Desligar e religar a PSN depois da regra nova:** o unlink anula as entradas. Ao religar, `settleListXp` não pode pagar de novo as mesmas chaves anuladas, nem pagar com chave nova o mesmo desbloqueio. Teste em A6: "a voided key is never paid again after relink".
- **A Sony muda o `trophyTitlePlatform` de uma lista já gravada** (ex.: `PS4` → `PS4,PS5`): o `console` da lista não muda depois de gravado, senão a chave da platina muda e paga duas vezes. Teste em A2: "ensureTrophyList never rewrites a stored console".
- **Sync do cron rodando durante o script de migração** (fase a, passo do `finish`): o script pega a trava de importação (`import-lease`) das contas que ressincroniza, e o cron pula essas contas. Teste em A10: "finish skips an account the cron holds".
- **Linhas Steam de jogos sem `steamAppId`** (seed, fixtures, jogos antigos): também ganham lista (`externalId = "game:<gameId>"`), senão o `NOT NULL` da fase d falha. Teste em A9.
- **Redirecionamento em cadeia e junções recusadas:** A→B e depois B→C leva A direto a C. Dois jogos com guia, ou com `steamAppId` diferentes, nunca se juntam. Testes em D3.

---

# Fase (a): etapas 1–2. Listas, syncs por lista, regra de XP, recálculo

### Task A1: Migration das listas

**Files:**
- Modify: `app/prisma/schema.prisma` (modelos acima; relações em `Game.trophyLists`, `User.trophyLists`; comentários de `Achievement`, `UserGame`, `XpLedgerEntry` atualizados com as chaves novas)
- Create: `app/prisma/migrations/20261108090000_trophy_lists/migration.sql`
- Test: `app/src/lib/db.test.ts` (o teste de schema que já existe)

**Interfaces:**
- Produces: modelos Prisma `TrophyList`, `UserTrophyList`, `Achievement.listId`, chave composta `listId_apiName`.

- [ ] **Step 1:** Escrever a migration à mão:
  - `CREATE TABLE` das duas tabelas, com FKs `ON DELETE CASCADE`;
  - `ALTER TABLE "Achievement" ADD COLUMN "listId" TEXT` + FK;
  - `DROP INDEX "Achievement_gameId_platform_apiName_key"`;
  - `CREATE UNIQUE INDEX "Achievement_listId_apiName_key"`;
  - `CREATE INDEX "Achievement_gameId_platform_idx"`.
- [ ] **Step 2:** `pnpm exec prisma migrate deploy` no `gamelog_test`, depois `pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --shadow-database-url …` (saída esperada: vazia).
- [ ] **Step 3:** `pnpm db:generate` e `pnpm exec tsc --noEmit`. Os erros esperados são só onde o código usa `gameId_platform_apiName` (lista que A3/A4 corrigem).
- [ ] **Step 4:** Commit `feat(db): trophy lists and per-list progress (additive)`.

### Task A2: Módulo de listas

**Files:**
- Create: `app/src/lib/trophies/lists.ts`, `app/src/lib/trophies/lists.test.ts`, `app/src/lib/trophies/lists.db.test.ts`

**Interfaces:**
- Produces:
  - `psnConsoleCode(trophyTitlePlatform: string): string | null`: ordem fixa `PS3, PSVITA, PS4, PS5, PSPC`, unida por `+`; `""` → `null`.
  - `xboxConsoleOf(devices: string[]): "360" | "ONE" | "PC" | null`: `Xbox360` → `360`; `XboxOne`/`XboxSeries` → `ONE`; só `PC`/`Win32` → `PC`.
  - `regionOf(name: string): "jp" | "kr" | null`.
  - `versionKey(list: { platform: string; console: string | null; externalId: string }): string`.
  - `versionLabel(list: { platform: string; console: string | null }): string`.
  - `regionLabels(lists: { id: string; region: string | null; createdAt: Date; externalId: string }[]): Map<string, string | null>`: id → `"🇯🇵 Ásia" | "🇰🇷 Ásia" | "Lista N" | null`.
  - `canonicalList<T extends { createdAt: Date; externalId: string }>(lists: T[]): T`.
  - `ensureTrophyList(db: Prisma.TransactionClient | PrismaClient, input: { gameId: string; platform: string; externalId: string; console: string | null; name: string; serviceName?: string | null; conceptId?: number | null; trophyCount: number }): Promise<{ id: string; gameId: string; console: string | null; createdAt: Date }>`:
    - upsert por `(platform, externalId)`;
    - preenche `console`/`conceptId`/`serviceName` só quando estão nulos;
    - atualiza `name`, `region` e `trophyCount`;
    - **nunca** muda o `gameId` de uma lista existente.

- [ ] **Step 1: Testes puros**:
  - `psnConsoleCode("PS3,PSVITA") === "PS3+PSVITA"`, `psnConsoleCode("PS5") === "PS5"`, `psnConsoleCode("") === null`;
  - `regionOf("グランド・セフト・オートV") === "jp"`, `regionOf("그랜드 테프트 오토 V") === "kr"`, `regionOf("Grand Theft Auto V") === null`;
  - `versionKey({platform:"psn",console:"PS5",externalId:"NPWR1"}) === "psn:PS5"`, `versionKey({platform:"steam",…}) === "steam"`, `versionKey({platform:"xbox",console:"ONE",externalId:"123"}) === "xbox:123"`;
  - `versionLabel({platform:"psn",console:"PS3+PSVITA"}) === "PS3 · Vita"`, `versionLabel({platform:"steam",console:"PC"}) === "PC · Steam"`;
  - `regionLabels`: duas listas sem região → `"Lista 1"`/`"Lista 2"` por `createdAt`; uma só → `null`; uma `jp` + uma sem região → `"🇯🇵 Ásia"` + `"Lista 1"`.
- [ ] **Step 2: Testes de banco**:
  - `ensureTrophyList creates then updates name and count`;
  - `ensureTrophyList never rewrites a stored console` (gravada `PS4`, chamada com `PS4+PS5` → continua `PS4`);
  - `ensureTrophyList never moves a list to another game`.
- [ ] **Step 3:** Implementar, rodar `pnpm exec vitest run src/lib/trophies` (PASS), commit `feat(trophies): trophy list helpers`.

### Task A3: Escritores do catálogo gravam `listId` (Steam e RA)

**Files:**
- Modify: `app/src/lib/sync/write-catalog-game.ts` (bloco de conquistas, ~l.121–162), `app/src/lib/sync/retro-achievements.ts` (~l.90–106), `app/prisma/seed.ts`, `app/scripts/catalog-bootstrap.ts` e qualquer fábrica de teste que crie `Achievement` (`grep -rn "achievement.create" src scripts prisma`)
- Test: `app/src/lib/sync/write-catalog-game.test.ts`, `app/src/lib/sync/retro-achievements.test.ts`

**Interfaces:**
- Consumes: `ensureTrophyList` (A2).
- Produces: toda linha `Achievement` nova tem `listId`.
  - Steam: lista `(steam, String(steamAppId))`, console `"PC"`, `trophyCount = schema.length`.
  - RA: lista `(retro, String(setId))`, console = nome do console do `RetroCatalogGame`.

- [ ] **Step 1:** Testes: `Steam achievements belong to the game's Steam list` (`listId` igual para todas as linhas, `TrophyList.trophyCount` = tamanho do schema) e `an RA set read on demand gets its own list`. Rodar: FAIL.
- [ ] **Step 2:** Implementar.
  - Nas linhas existentes sem `listId` do mesmo jogo/plataforma, o mesmo `updateMany` preenche o `listId`.
  - A busca por `apiName` passa a ser por `listId`.
  - Nada mais muda no fluxo da Steam.
- [ ] **Step 3:** `grep -rn "gameId_platform_apiName" src scripts prisma` não encontra nada. Rodar `pnpm exec vitest run src/lib/sync` (PASS, Steam inclusa sem alterar os testes). Commit `feat(sync): catalog writers attach achievements to their list`.

### Task A4: Sync de PSN/Xbox/RA grava por lista

**Files:**
- Modify:
  - `app/src/lib/integrations/psn/types.ts` + `client.ts`: `PsnTitle` já traz `platform` e `serviceName`; nada novo aqui.
  - `app/src/lib/integrations/xbox/types.ts` + `client.ts`: `XboxTitle.devices: string[]`, lido de `devices` do title history.
  - `app/src/lib/sync/platform-library.ts`: `LibraryTitle` ganha `console: string | null` e `serviceName?: string`.
  - `app/src/lib/sync/platform-user.ts`: `recordTitle`, `storedProgress`, mapas de antifraude.
  - `app/src/lib/integrations/psn/fixture.ts`: GTA V com listas PS3 (20 obtidos), PS4 (46) e PS5 (26).
- Test: `app/src/lib/sync/platform-user.test.ts`, `app/src/lib/sync/platform-library.test.ts`

**Interfaces:**
- Consumes: `ensureTrophyList`, `psnConsoleCode`, `xboxConsoleOf` (A2); `settleListXp` (A6). A6 vem **antes** desta tarefa na execução: ver a ordem no fim do plano.
- Produces, para cada título gravado:
  - `TrophyList`;
  - `Achievement` por `(listId, apiName)`;
  - `UserTrophyList` (`unlockedCount`, `hardcoreCount` e `completedAt` da lista);
  - `UserGame` agregado como em "Decisões".
  - `storedProgress` lê primeiro `UserTrophyList` (chave = `externalId` da lista). Para listas sem linha, vale o comportamento atual: memória `platform-titles` e depois o `UserGame`.

- [ ] **Step 1: Testes** (FAIL):
  - `a game with PS3, PS4 and PS5 lists keeps every trophy`: 3 `TrophyList` no mesmo `Game`, 92 `UserAchievement`, `UserGame.unlockedCount === 92`, 3 `UserTrophyList`;
  - `a second sync of that game reads nothing` (`titles.read === 0`);
  - o teste existente `a game with a PS4 and a PS5 trophy list is not read again on every sync` continua passando sem mudança;
  - `an Xbox 360 title and its One title are two lists of one game` (fixture Xbox com `devices`).
- [ ] **Step 2:** Implementar `recordTitle`:
  - os mapas `known`/`idByKey` passam a usar a chave `${listId}:${apiName}`;
  - o bloco de ledger dentro da transação sai e entra `await settleListXp(tx, userId, platform, [gameId], seenAt)`;
  - o reajuste `owned > unlocked.length` some, porque o `UserGame` agregado já soma tudo.
- [ ] **Step 3:** Rodar `pnpm exec vitest run src/lib/sync` (PASS). Commit `feat(sync): psn/xbox/retro record progress per trophy list`.

### Task A5: Listas regionais se agrupam pelo conceito da PSN

**Files:**
- Modify:
  - `app/src/lib/integrations/psn/types.ts` + `client.ts`:
    - `PsnPlayedGame` ganha `conceptId: number | null` e `conceptTitleIds: string[]`;
    - método novo `getTrophyListsOfTitles(accountId, titleIds: string[]): Promise<Map<string, string[]> | "private">` (lotes de 5; num 404 do lote, repete um a um; um id com 404 sozinho fica com `[]`).
  - `app/src/lib/sync/platform-library.ts`: `readPsn` devolve `concepts: { npToConcept: Map<string, number>; conceptTitleIds: Map<number, string[]> }`.
  - `app/src/lib/sync/platform-games.ts`: `resolvePlatformGame(platform, title, names, { igdb, conceptId?, conceptTitleIds? })`. O conceito vem logo depois do link direto: se alguma `TrophyList` tem o `conceptId`, ou algum `titleId` do conceito tem `GamePlatformLink`, usa esse jogo.
  - `app/src/lib/sync/platform-user.ts`: passa o conceito ao resolver e grava `conceptId` na lista.
- Create: `app/src/lib/sync/psn-concepts.ts`: `mapNewTitles(accountId: string, linkedAccountId: string, played: PsnPlayedGame[], limit = 50): Promise<Map<string, number>>` (npCommunicationId → conceptId). A memória fica em `SyncCursor psn-concepts:<linkedAccountId>`, no formato `{ externalId, linkedAt, mapped: string[] }`, e zera num relink, como `rememberedTitles`.
- Test: `app/src/lib/integrations/psn/client.test.ts`, `app/src/lib/sync/psn-concepts.test.ts`, `app/src/lib/sync/platform-user.test.ts`

- [ ] **Step 1: Testes** (FAIL):
  - cliente: `maps title ids in batches of five` e `retries one by one when a batch answers 404`;
  - sync: `a Japanese-named PS5 list of the same concept lands on the same game` (fixture: `NPWR_JP` "グランド・セフト・オートV" no conceito do GTA). O resultado esperado é um `Game`, duas `TrophyList` PS5, a `region` da JP igual a `"jp"` e o `versionKey` igual;
  - `at most 50 new title ids are mapped per sync`.
- [ ] **Step 2:** Implementar. Rodar `pnpm exec vitest run src/lib/sync src/lib/integrations/psn` (PASS). Commit `feat(psn): regional lists of one concept join the same game`.

### Task A6: Regra de XP por versão (`settleListXp`)

**Files:**
- Create: `app/src/lib/progression/list-xp.ts`, `app/src/lib/progression/list-xp.test.ts` (puro), `app/src/lib/progression/list-xp.db.test.ts`
- Modify:
  - `app/src/lib/progression/recompute.ts`: `platinumSourceKey` e `platinumGameId` passam para `list-xp.ts` e são reexportados.
  - `app/src/lib/admin/fraud.ts`: o "Liberar" de PSN/Xbox/RA chama `settleListXp` (a Steam segue igual).
  - `voidFraudEntries` em `recompute.ts`: para plataformas não Steam, depois de marcar suspeito e limpar a conclusão, chama `settleListXp` dos jogos afetados (a Steam segue igual).

**Interfaces:**
- Produces:
  - `platinumSourceKey(platform: string, gameId: string, list?: { console: string | null; externalId: string }): string`, com as chaves das Decisões. Sem `list`, só a Steam é aceita.
  - `platinumGameId(sourceKey: string): string` (depois do último `:`).
  - `type LedgerDraft = { source: "achievement" | "platinum"; sourceKey: string; xp: number; platform: string; createdAt: Date; skills: string[] }`.
  - `desiredListEntries(input: { platform: CodePlatform; gameId: string; skills: string[]; lists: ListRow[]; achievements: AchievementRow[]; unlocks: UnlockRow[]; progress: ProgressRow[] }): LedgerDraft[]`, pura. As linhas carregam o que `xpForPlatformAchievement` e `platinumBonus` precisam: `globalPct`, `points`, `trophyTier`, `hardcore` e `suspicious`.
  - `settleListXp(tx: Prisma.TransactionClient, userId: string, platform: CodePlatform, gameIds: string[], now: Date): Promise<{ paid: number; voided: number }>`:
    - entradas existentes do jogo = `achievement` com `sourceKey` entre os ids de `Achievement` do jogo/plataforma, mais `platinum` daquela plataforma com `sourceKey` terminando em `:<gameId>`;
    - existente válida fora do desejado → recebe `voidedAt = now`;
    - desejada sem nenhuma linha com aquela chave (válida **ou anulada**) → `createMany skipDuplicates`.
  - `rebuildListXp(userId: string, now?: Date): Promise<{ paid: number; voided: number }>`: chama `settleListXp` para cada jogo PSN/Xbox/RA do usuário (com desbloqueio ou com entrada no ledger) e depois `recomputeUser`.

- [ ] **Step 1: Testes puros** (FAIL):
  - `PS4 and PS5 platinums are two entries`: chaves `psn:PS4:g` e `psn:PS5:g`;
  - `two regional PS5 lists pay the platinum once`;
  - `a trophy earned in both regions is paid once, at the earliest unlock, keyed to the canonical achievement`;
  - `a trophy earned only in the second region is paid once, keyed to the canonical achievement`;
  - `suspicious unlocks are not desired`;
  - `xbox platinum key carries the titleId`.
- [ ] **Step 2: Testes de banco** (FAIL):
  - `legacy psn:<gameId> platinum is voided and replaced by psn:PS5:<gameId> with the same xp`;
  - `a voided key is never paid again after relink`;
  - `Steam ledger rows are never touched` (linhas Steam idênticas antes/depois de `rebuildListXp`);
  - `rebuildListXp twice changes nothing the second time` (`{paid:0, voided:0}`).
- [ ] **Step 3:** Implementar. Rodar `pnpm exec vitest run src/lib/progression src/lib/admin` (PASS). Commit `feat(xp): one reconcile for psn/xbox/retro trophies by version`.

### Task A7: "Uma vez por console" no ranking, atributos, missões e contador de platinas

**Files:**
- Create: `app/src/lib/trophies/counted.ts` + `counted.test.ts`
- Modify:
  - `app/src/lib/progression/recompute.ts`: `loadValidUnlocks` e `loadUnlockEvents` trazem `achievement.apiName` + `achievement.list.{platform,console,externalId}`; `attributeInput` e as missões usam `countedUnlocks`.
  - `app/src/lib/highscores/write.ts`: `rankStatsWrites` conta sobre `countedUnlocks`.
  - `app/src/lib/character/counts.ts`: `nativePlatinums` devolve `DISTINCT gameId, platform, versionKey`.
  - `regionalExtras(userId, db): Promise<number>`, nova: platinas PSN obtidas em listas que não são a primeira obtida da versão.
- Test: `app/src/lib/highscores/write.test.ts`, `app/src/lib/character/counts.test.ts`, `app/src/lib/progression/recompute.test.ts`

**Interfaces:**
- Produces:
  - `countedUnlocks<T extends { achievement: { gameId: string; platform: string; apiName: string; list: { platform: string; console: string | null; externalId: string } | null }; unlockedAt: Date }>(rows: T[]): T[]`: linha sem lista conta sozinha;
  - `regionalExtras(userId: string, db?: Db): Promise<number>`.

- [ ] **Step 1: Testes** (FAIL):
  - `a trophy earned in two PS5 regions counts once for rank stats` (`achievements` = 1);
  - `profile total still counts both` (`getProfileSummary(...).achievements` = 2);
  - `PS4 + PS5 platinum = 2 platinums, a second PS5 region = 1 regional extra`.
- [ ] **Step 2:** Implementar. Rodar a pasta `src/lib` (PASS). Commit `feat(progression): count regional duplicates once for xp, ranking and attributes`.

### Task A8: Xbox 360 no robô do Xbox

**Files:**
- Modify (se preciso): `app/src/lib/integrations/xbox/client.ts` + `client.test.ts`
- Create: `scratchpad/spike/xbox-360.mjs` (fora do repo; lê `XBOX_OPENXBL_KEY` de `.env.chaves` sem imprimir)

- [ ] **Step 1:** Rodar o spike com a conta Xbox do diguzz (XUID no `LinkedAccount` xbox). Ele lista os títulos com `devices` contendo `Xbox360` e chama `/achievements/player/{xuid}/{titleId}` para um deles.
- [ ] **Step 2:**
  - Se vierem conquistas: escrever o teste `parses devices of the title history` e parar aqui.
  - Se vier vazio: o teste é `a 360 title reads achievements from the 360 route`. Implementar a rota de 360 do OpenXBL (conferir o caminho exato na documentação do OpenXBL antes) só para títulos com `Xbox360` em `devices`.
- [ ] **Step 3:** Rodar `pnpm exec vitest run src/lib/integrations/xbox` (PASS). Commit `fix(xbox): 360 titles import their achievements` ou `test(xbox): …`.

### Task A9: Preenchimento a partir dos dados atuais

**Files:**
- Create: `app/scripts/trophy-lists-backfill.ts`, `app/src/lib/trophies/backfill.ts`, `app/src/lib/trophies/backfill.db.test.ts`
- Modify: `app/package.json` (`"trophy-lists:backfill": "tsx scripts/trophy-lists-backfill.ts"`)

**Interfaces:**
- Produces: `backfillTrophyLists({ dryRun }): Promise<BackfillReport>`, idempotente, em lotes de 2.000. `BackfillReport = { listsCreated, achievementsLinked, achievementsLeftForResync, userListsCreated, steamWithoutAppId }`. Passos:
  1. **Steam:** uma lista por jogo com `Achievement` steam: `externalId = steamAppId` ou `"game:<gameId>"` sem appid, console `"PC"`. Todas as linhas steam do jogo recebem o `listId`.
  2. **PSN/Xbox/RA:** uma lista por `GamePlatformLink` que é lista: PSN `NPWR%`; Xbox e RA todos os links do jogo com `Achievement` naquela plataforma. Console `null`, `name` = nome do jogo, `trophyCount` = linhas.
  3. **Jogo com uma lista só na plataforma:** as linhas recebem o `listId` e `UserTrophyList` é copiada do `UserGame` (`unlockedCount`, `completedAt`; RA conta `hardcoreCount`).
  4. **Jogo PSN com mais de uma lista:** as linhas ficam com `listId` nulo (contadas em `achievementsLeftForResync`), e nenhuma `UserTrophyList` é criada, para o sync reler essas listas.

- [ ] **Step 1: Testes** (FAIL):
  - `single-list psn game is linked in place`;
  - `multi-list psn game is left for the resync`;
  - `steam game without appid gets a game: list`;
  - `running twice creates nothing new`;
  - `dry run writes nothing`.
- [ ] **Step 2:** Implementar com SQL em lote (`INSERT … SELECT`, `UPDATE … FROM`). Rodar os testes (PASS). Commit `feat(trophies): backfill lists from current data`.

### Task A10: Script de fechamento da fase (ressync, limpeza, recálculo, conferência)

**Files:**
- Create:
  - `app/scripts/trophy-lists-finish.ts` + `app/src/lib/trophies/finish.ts` + `finish.db.test.ts`;
  - `app/scripts/trophy-lists-snapshot.ts` (Steam e totais por usuário, JSON em `C:\Users\luck_\tralked-backups\snapshot-<fase>-<antes|depois>.json`);
  - `app/scripts/psn-compare.ts` (Sony × Tralked por usuário: listas, troféus obtidos, platinas; NPSSO de `.env.chaves`).
- Modify: `app/package.json` (`trophy-lists:finish`, `trophy-lists:snapshot`, `psn:compare`)

**Interfaces:**
- Consumes: `syncPlatformAccount(userId, "psn", { full: true })`, `busyImports`/lease de `lib/sync/import-lease.ts`, `rebuildListXp` (A6).
- Produces: `finishTrophyLists({ dryRun, users? }): Promise<FinishReport>`.
  1. Para cada `LinkedAccount` PSN ativa: pega a trava de importação e roda `full: true` (pula a conta e avisa quando o cron a tem).
  2. **Guias:** `GuideAchievementNote` presas em linhas PSN com `listId` nulo passam para a linha de mesmo `apiName` na lista canônica do jogo.
  3. Apaga as `Achievement` PSN com `listId` nulo de jogos que já têm lista PSN (cascata em `UserAchievement`).
  4. `rebuildListXp` de todos os usuários.
  5. Relatório por usuário: troféus, platinas, extras regionais, XP antes/depois.

- [ ] **Step 1: Testes** (FAIL):
  - `finish moves guide notes before deleting collapsed rows`;
  - `finish skips an account the cron holds`;
  - `dry run reports without writing`.
- [ ] **Step 2:** Implementar. Rodar os testes (PASS). Rodar a suíte inteira, `tsc` e `lint`. Commit `feat(trophies): finish script (resync, cleanup, xp rebuild, reports)`.

### Task A11: Publicar a fase (a) em produção

- [ ] **Step 1:** Revisão do branch (`superpowers:requesting-code-review`); corrigir o que vier.
- [ ] **Step 2:** `pnpm trophy-lists:snapshot --label a-antes` e `pnpm psn:compare` (registra os 18.981 e os 16.310 de hoje).
- [ ] **Step 3: Parar e mandar ao Lucas** a lista exata do que muda em produção:
  - migration `20261108090000_trophy_lists`;
  - backfill (números do `--dry-run`);
  - ressync PSN das 3 contas;
  - linhas colapsadas apagadas (número do `finish --dry-run`);
  - XP de cada usuário antes → depois.
  
  Esperar o "ok".
- [ ] **Step 4:** `pg_dump -Fc` em `C:\Users\luck_\tralked-backups\neon-before-trophy-lists-<data>.dump` e `prisma migrate deploy` com `DATABASE_URL_UNPOOLED`.
- [ ] **Step 5:** Merge `--no-ff` na `main`, push e espera do status Vercel `success`.
- [ ] **Step 6:** `pnpm trophy-lists:backfill`, depois `pnpm trophy-lists:finish`, depois `pnpm trophy-lists:snapshot --label a-depois`.
  - Conferir: Steam idêntica; diguzz com ~18.981 troféus PSN (`pnpm psn:compare`, diferença ≤ 0,5%).
  - Se a Steam mudar, ou a diferença passar de 0,5%: parar e investigar (`superpowers:systematic-debugging`), sem seguir para a fase (b).
- [ ] **Step 7:** Conferir no site o perfil do diguzz (total de troféus) e o XP dos dois. Resumo para o Lucas.

---

# Fase (b): etapa 3. Página do jogo (opção A) e perfil (opção B)

### Task B0: Mockup para aprovação

- [ ] **Step 1:** Ler os tokens e classes atuais (`app/src/app/globals.css`, `tk-cut*`, `components/game/BookletSpread.tsx`, `components/profile/ProfileHeader.tsx`, `components/catalog/CatalogFilters.tsx`) e os protótipos de organização em `.superpowers/brainstorm/259-1793677874/content/` da raiz, se ainda existirem.
- [ ] **Step 2:** Publicar um artifact com três quadros, só com as cores e cantos do site:
  1. **Página do jogo, GTA V com o diguzz:**
     - linhas `PS5 · Platina`, `PS4 · Platina`, `PS3 · 20/59` e `PC · Steam 64%`;
     - etiquetas de região `Lista 1 ✓`, `🇯🇵 Ásia ✓` com "2 listas · conta 1";
     - abas por versão e um troféu marcado com as regiões em que foi obtido;
     - estado de visitante sem marcas.
  2. **Perfil:**
     - grade de capas com selos `PS5 ✓²`, `PS4 ✓` e `PC 64%`;
     - topo com "Platinas (contam no XP)", "Listas regionais extras", "Jogos" e "Nível".
  3. **Busca:** os botões "Só exclusivos" e "Só com troféus" nos filtros de `/jogos` (desktop e painel inferior do celular), e o rótulo "PC · Steam".
- [ ] **Step 3:** Mandar o link ao Lucas e **esperar a aprovação**. Os ajustes pedidos entram no mockup antes de seguir.

### Task B1: Consultas de versões

**Files:**
- Create: `app/src/lib/queries/game-versions.ts`, `game-versions.test.ts` (puro), `game-versions.db.test.ts`

**Interfaces:**
- Consumes: `versionKey`, `versionLabel`, `regionLabels`, `canonicalList` (A2), `tierOf` (`lib/queries/game-profile.ts`).
- Produces:
  ```ts
  type VersionList = { id: string; label: string | null; trophyCount: number };
  type VersionTrophy = { apiName: string; name: string; description: string | null; iconUrl: string | null; tier: TrophyTier; globalPct: number | null; hidden: boolean };
  type GameVersion = { key: string; platform: PlatformId; label: string; total: number; tiers: TierCounts; nativePlatinum: boolean; lists: VersionList[]; trophies: VersionTrophy[] /* da primeira lista */ };
  type PlayerVersion = { key: string; unlocked: number; total: number; pct: number; platinum: boolean; lists: { id: string; label: string | null; complete: boolean; unlocked: number }[]; countedNote: string | null /* "2 listas · conta 1" */; earnedIn: Record<string, string[]> /* apiName → rótulos das listas */ };
  getGameVersions(gameId: string): Promise<GameVersion[]>   // público, entra no cache de loadGameProfile
  getPlayerVersions(gameId: string, userId: string): Promise<PlayerVersion[]>  // ilha por usuário, sem cache
  ```
  - Ordem: Steam, PSN (PS5, PS4, PS3, Vita), Xbox, RA.
  - A Steam usa a lista Steam do jogo e o `UserGame` steam (total = `achievementCount`, como hoje).
  - `pct`/`unlocked` de uma versão com várias regiões = a melhor lista da versão.

- [ ] **Step 1: Testes** (FAIL):
  - `GTA V has three PSN versions and Steam in order`;
  - `a version with two regions shows both labels and the note "2 listas · conta 1"`;
  - `earnedIn marks a trophy with the regions it was earned in, matched by apiName`;
  - `a visitor sees the first region's trophies`.
- [ ] **Step 2:** Implementar, PASS, commit `feat(game): versions of a game and of a player`.

### Task B2: Linhas por versão e abas na página do jogo

**Files:**
- Create: `app/src/components/game/VersionRows.tsx` + `.test.tsx`, `app/src/components/game/VersionTabs.tsx` + `.test.tsx`
- Modify:
  - `app/src/components/game/BookletSpread.tsx` (`BookletProgress`): `VersionRows` entra no lugar de `PlatformProgressSwitch`, e o disco mostra a melhor versão.
  - `app/src/app/jogos/[slug]/page.tsx`: `VersionTabs` logo abaixo da área de progresso; a parte do usuário fica dentro do `Suspense` que já existe.
  - `app/src/lib/queries/game-profile.ts`: `GameProfile.versions: GameVersion[]`; `getPlayerGamePlatforms` devolve também `versions`.

- [ ] **Step 1: Testes de componente** (FAIL):
  - `VersionRows renders one row per version with PLATINA or %`;
  - `region chips show ✓ for completed lists`;
  - `VersionTabs switches the trophy list with arrow keys` (abas com `role="tab"`);
  - `visitor rows have no marks`.
- [ ] **Step 2:** Implementar seguindo o mockup aprovado. PASS. Conferir no dev (`superpowers` skill `run`, ou `pnpm dev` + navegador) a página `/jogos/grand-theft-auto-v` no banco `gamelog_dev`, com dados de fixture. Commit `feat(game): progress by version and trophy tabs`.

### Task B3: Perfil em grade com selos e contadores

**Files:**
- Create: `app/src/components/profile/LibraryCoverGrid.tsx` + `.test.tsx`
- Modify:
  - `app/src/lib/library/queries.ts`: `LibraryGame.versions: { label: string; pct: number | null; platinum: boolean; regions: number }[]`, via `TrophyList`/`UserTrophyList` (Steam pelo `UserGame`).
  - `app/src/app/jogador/[handle]/jogos/page.tsx`: a grade é a vista principal, e a lista atual fica como alternativa se o mockup aprovado mantiver.
  - `app/src/lib/profile/queries.ts`: `ProfileSummary` ganha `platinums`, `regionalExtras` e `gamesCount`.
  - `app/src/components/profile/ProfileHeader.tsx`: os quatro contadores.

- [ ] **Step 1: Testes** (FAIL):
  - `badge PS5 ✓² for a platinum in two regions`;
  - `PC 64% for a Steam version`;
  - `header shows Platinas (contam no XP) and Listas regionais extras`.
- [ ] **Step 2:** Implementar, PASS, commit `feat(profile): cover grid with version badges and counters`.

### Task B4: Publicar a fase (b)

- [ ] **Step 1:** Rodar a suíte inteira, `tsc`, `lint` e a revisão do branch.
- [ ] **Step 2:** Merge `--no-ff`, push e espera do Vercel. Esta fase não tem migration.
- [ ] **Step 3:** Conferir no site:
  - `/jogos/grand-theft-auto-v` logado como visitante (três versões PSN e a Steam);
  - o perfil do diguzz (selos e contadores);
  - o snapshot da Steam continua idêntico.
- [ ] **Step 4:** Resumo ao Lucas.

---

# Fase (c): etapa 4. Busca

### Task C1: Consoles do IGDB por jogo

**Files:**
- Modify: `app/prisma/schema.prisma` (`Game.consoles String[] @default([])`, com o comentário de que são slugs IGDB: `ps3 ps4 ps5 psvita xbox360 xboxone series-x-s switch pc …`)
- Create:
  - `app/prisma/migrations/20261109090000_game_consoles/migration.sql` (coluna + índice GIN);
  - `app/scripts/igdb-consoles-backfill.ts` (`pnpm igdb:consoles`: 500 `igdbId` por pedido, `UPDATE … FROM (VALUES …)` em lotes; normaliza os ~235 jogos com `platforms` em forma de console, como `PS4` → família `PLAYSTATION` + console `ps4`).
- Modify:
  - `app/src/lib/sync/igdb-games.ts`: grava `consoles` junto com `families`.
  - `app/src/lib/sync/platform-games.ts`: jogo criado pelo sync grava a família em `platforms` e o console em `consoles`.
- Test: `app/src/lib/sync/igdb-games.test.ts`, `app/src/lib/sync/platform-games.test.ts`

- [ ] **Step 1: Testes** (FAIL):
  - `igdb import writes consoles`;
  - `a PSN-created game is PLAYSTATION with console ps5`.
- [ ] **Step 2:** Implementar, PASS, commit `feat(catalog): per-console platforms from IGDB`.

### Task C2: Filtros "Só exclusivos" e "Só com troféus"

**Files:**
- Modify: `app/src/lib/queries/games.ts` (`GameFilter` ganha `exclusive?: boolean`, `withTrophies?: boolean`; `platformWhere` vira `catalogWhere(filter)`)
- Test: `app/src/lib/queries/games.db.test.ts` (ou o teste de `listGames` que já existe)

**Interfaces:**
- Produces: `catalogWhere(filter: Pick<GameFilter, "platform" | "exclusive" | "withTrophies">): Prisma.GameWhereInput`.
  - **Família de um jogo:**
    - `platforms` (IGDB);
    - `GamePlatformLink` (psn → PLAYSTATION, xbox → XBOX);
    - `steamAppId` → PC.
  - **PC** = `steamAppId` não nulo (rótulo "PC · Steam").
  - **Exclusivo de X:** tem X e nenhuma outra de PC/PLAYSTATION/XBOX/NINTENDO. Retro não entra na conta.
  - **Com troféus:**
    - PLAYSTATION: `consoles` com `ps4|ps5|psvita`, ou `ps3` com `releaseDate ≥ 2008-01-01`, ou alguma `TrophyList` psn com `trophyCount > 0`;
    - XBOX: `consoles` com `xbox360|xboxone|series-x-s`, ou lista xbox;
    - PC: `achievementCount > 0`;
    - RETRO: lista retro ou `RetroCatalogGame` ligado com `achievementCount > 0`;
    - NINTENDO: nunca;
    - sem plataforma: qualquer um desses.

- [ ] **Step 1: Testes** (FAIL):
  - `PS4+PS5 game is a PlayStation exclusive`;
  - `a game later on Steam is not exclusive`;
  - `a 2007 PS3 game without a known list has no trophies, a 2009 one has`;
  - `Nintendo with trophies returns nothing`;
  - `PC filter keeps only games with a Steam appid`.
- [ ] **Step 2:** Implementar, PASS, commit `feat(search): exclusives and with-trophies filters`.

### Task C3: Botões na tela de `/jogos`

**Files:**
- Modify: `app/src/components/catalog/CatalogFilters.tsx` + `.test.tsx`, `app/src/app/jogos/page.tsx` (parâmetros `exclusivos=1` e `trofeus=1`)

- [ ] **Step 1: Testes** (FAIL):
  - `toggles keep the other params`;
  - `Só com troféus is disabled on Nintendo with a hint`;
  - `PC label reads "PC · Steam"`.
- [ ] **Step 2:** Implementar seguindo o mockup aprovado (B0, quadro 3). PASS. Commit `feat(search): exclusives and trophies toggles`.

### Task C4: Publicar a fase (c)

- [ ] **Step 1:** Rodar a suíte, `tsc`, `lint` e a revisão.
- [ ] **Step 2: Parar e mandar ao Lucas:**
  - migration `20261109090000_game_consoles`;
  - backfill IGDB (~185 pedidos, ~92 mil linhas atualizadas);
  - normalização dos ~235 jogos.
  
  Esperar o "ok".
- [ ] **Step 3:** Backup, `migrate deploy`, merge `--no-ff`, push e espera do Vercel. Depois `pnpm igdb:consoles`, com o IGDB lido das variáveis da Vercel (`vercel env pull` para um arquivo temporário apagado no fim, ou o Lucas roda).
- [ ] **Step 4:** Conferir no site:
  - `/jogos?platform=PLAYSTATION&exclusivos=1` (Ghost of Yōtei aparece e GTA V não);
  - `trofeus=1` com cada plataforma.
- [ ] **Step 5:** Resumo ao Lucas.

---

# Fase (d): etapas 5–6. Duplicados e limpeza

### Task D1: Tabelas de redirecionamento e de edições

**Files:**
- Modify: `app/prisma/schema.prisma`
  ```prisma
  model GameSlugRedirect { fromSlug String @id; gameId String; createdAt DateTime @default(now()); game Game @relation(fields: [gameId], references: [id], onDelete: Cascade) @@index([gameId]) }
  model GameEdition { gameId String; otherId String; game Game @relation("Editions", …, onDelete: Cascade); other Game @relation("EditionOf", …, onDelete: Cascade) @@id([gameId, otherId]) }
  ```
- Create: `app/prisma/migrations/20261110090000_game_redirects_editions/migration.sql`
- Modify: `app/src/app/jogos/[slug]/page.tsx`, `jogos/[slug]/guia/page.tsx` e `metadata.ts`. Quando o slug não existe, procuram `GameSlugRedirect` e chamam `permanentRedirect` para `/jogos/<novo>` (mantendo o subcaminho). Também o `generateMetadata`.
- Create: `app/src/lib/catalog/redirects.ts` (`resolveSlugRedirect(slug): Promise<string | null>`) + `.db.test.ts`
- Modify: página do jogo, com a seção "Outras edições" (links para os `GameEdition` dos dois lados, no visual atual de link de seção).

- [ ] **Step 1: Testes** (FAIL):
  - `old slug redirects to the kept game`;
  - `guia subpath keeps its path`;
  - `unknown slug still 404s`.
- [ ] **Step 2:** Implementar, PASS, commit `feat(catalog): slug redirects and other editions`.

### Task D2: Relatório de candidatos a duplicado (sem mudar nada)

**Files:**
- Create: `app/src/lib/catalog/duplicates.ts` + `.db.test.ts`, `app/scripts/games-duplicates.ts` (`pnpm games:duplicates`)

**Interfaces:**
- Produces:
  - `findDuplicateCandidates(): Promise<DuplicateGroup[]>`, onde `DuplicateGroup = { keep: GameRef; drop: GameRef; verdict: "junta" | "nao-junta-steam" | "nao-junta-guia" | "outra-edicao"; reasons: string[]; moves: Record<string, number> }`.
  - O script grava `docs/relatorios/duplicados-<data>.json` e `.md` (tabela legível) na raiz do repositório e **não escreve no banco**.
  - **Regras para virar candidato:**
    - mesmo `searchName`;
    - alias cruzado;
    - `withoutEdition(nome)` de um igual ao nome do outro.
  - **Quem fica:**
    - tem `steamAppId`;
    - não é stub;
    - tem mais `UserGame`;
    - tem `igdbId`;
    - é o `createdAt` mais antigo.
  - **Veredito:**
    - os dois com `steamAppId` → `nao-junta-steam`;
    - os dois com `Guide` → `nao-junta-guia`;
    - nome com Remastered/Remake/Director's Cut/Part I/Definitive, ou listas próprias do mesmo console nos dois → `outra-edicao`;
    - o resto → `junta`.

- [ ] **Step 1: Testes** (FAIL):
  - `ghost-of-yotei and its digital deluxe edition are one group`;
  - `two steam games are never joined`;
  - `Death Stranding and Director's Cut are other editions`;
  - `the script writes no rows`.
- [ ] **Step 2:** Implementar, PASS, commit `feat(catalog): duplicate candidates report (read-only)`.
- [ ] **Step 3:** Rodar contra produção (só leitura), salvar o relatório, commitar os arquivos de relatório, **mandar ao Lucas** e esperar a lista aprovada. As marcações dele vão para `docs/relatorios/duplicados-<data>-aprovado.json`.

### Task D3: Rotina de junção

**Files:**
- Create: `app/src/lib/catalog/merge-games.ts` + `merge-games.db.test.ts`

**Interfaces:**
- Consumes: `settleListXp`, `rebuildListXp` (A6), `recomputeUser`.
- Produces: `mergeGames(keepId: string, dropId: string, { dryRun, now }): Promise<MergeReport>`, numa transação. Recusa (`MergeRefused` com o motivo) quando os dois têm `steamAppId`, os dois têm `Guide`, ou `keepId === dropId`. O que acontece com cada tabela:

  | Tabela | O que acontece |
  |---|---|
  | `GamePlatformLink`, `TrophyList`, `Achievement` | passam para `keepId` |
  | `GameMedia` | passa, sem `url` repetida |
  | `GameSkill` | união |
  | `UserGame` | por `(userId, platform)`: horas somadas, `unlockedCount` recontado, `completedAt` menor, `lastPlayedAt` maior, `playtime2WeeksMin` maior, `checkedPlaytimeMin`/`playtimePaidMin` do `keep` |
  | `WishlistItem`, `GameOpen`, `ArticleGame` | sem repetição |
  | `GameRelease` | por plataforma, fica a do `keep` (a do `drop` só entra quando falta) |
  | `SteamPlayerCount` | move se o `keep` não tem |
  | `Guide`, `Article.gameId`, `ExternalNews`, `ForumThread`, `Photo`, `GuideRequest.gameId` | passam para `keepId` |
  | `GameEdition` | os dois lados passam |
  | `steamAppId`, `igdbId`, `rawgId`, `sgdbId`, textos e capas | o `keep` herda o que não tem (o `steamAppId` é limpo no `drop` antes) |
  | `aliases` | o `keep` ganha o nome e os aliases do `drop` |
  | `GameSlugRedirect` | entra `drop.slug → keepId`, e os redirecionamentos que apontavam para o `drop` passam a apontar para o `keep` |
  | o próprio `drop` | é apagado |

  **Ledger:**
  - entradas `platinum`/`playtime` com o `dropId` na chave são anuladas;
  - entra uma cópia (mesmo `xp`, `createdAt`, `platform`) com o `keepId`, quando a chave nova ainda não existe;
  - depois, `settleListXp` dos usuários afetados e `recomputeUser`.

  `MergeReport = { moved: Record<string, number>; usersRecomputed: string[] }`. O executor confere a lista de tabelas contra o `schema.prisma` (`grep -n "gameId" app/prisma/schema.prisma`) e nenhuma tabela com `gameId` pode ficar de fora.

- [ ] **Step 1: Testes** (FAIL):
  - `every table with gameId moves` (um jogo `drop` com uma linha em cada tabela);
  - `user rows merge playtime and unlocks`;
  - `hour milestones are not paid twice after a merge`;
  - `regional lists of two duplicates count once after the merge`;
  - `two steam games are refused`;
  - `A→B then B→C redirects A to C`;
  - `dry run writes nothing`.
- [ ] **Step 2:** Implementar, PASS, commit `feat(catalog): merge duplicate games`.

### Task D4: Ensaio numa cópia e junção em produção

**Files:**
- Create: `app/scripts/games-merge.ts` (`pnpm games:merge --file <aprovado.json> [--dry-run]`)

- [ ] **Step 1:** `pg_dump` do Neon, restaurado no Docker em `gamelog_rehearsal` (`createdb` + `pg_restore`). Rodar o merge lá com `DATABASE_URL` apontando para `gamelog_rehearsal`. Conferir:
  - os slugs antigos;
  - a contagem de troféus e o XP dos 3 usuários (`trophy-lists:snapshot` contra o ensaio);
  - nenhuma linha órfã.
- [ ] **Step 2: Parar e mandar ao Lucas** o que o ensaio mostrou (jogos juntados, linhas movidas, XP antes → depois) e esperar o "ok".
- [ ] **Step 3:** Backup novo, `migrate deploy` (D1), merge `--no-ff`, push e espera do Vercel. Só então `pnpm games:merge --file …` em produção.

### Task D5: Limpeza da estrutura antiga (etapa 6)

**Files:**
- Create: `app/prisma/migrations/20261110100000_trophy_lists_cleanup/migration.sql`. Começa com um `DO $$ … RAISE EXCEPTION` se ainda houver `Achievement."listId" IS NULL`; depois vêm `ALTER COLUMN "listId" SET NOT NULL` e `DELETE FROM "SyncCursor" WHERE key LIKE 'platform-titles:%'`.
- Modify:
  - `schema.prisma`: `listId String` obrigatório.
  - `platform-user.ts`: saem `rememberTitles`, `rememberedTitles`, `titleMemoryKey` e o recurso do `UserGame` em `storedProgress`.
  - `platform-library.ts`: sai `LibraryTitle.listed`, se não sobrar uso.
  - Sai `components/game/PlatformProgressSwitch.tsx` (+ teste), se não tiver mais uso.
  - Os comentários do schema sobre "PS4/PS5 share a row" e a convenção antiga de `platinum` passam a descrever o modelo novo.
- Test: suíte inteira. O teste `a game with a PS4 and a PS5 trophy list is not read again on every sync` continua passando, agora por `UserTrophyList`.

- [ ] **Step 1:** Remover, ajustar os testes que dependiam da memória `platform-titles` (eles passam a usar `UserTrophyList`), rodar a suíte inteira, `tsc` e `lint`. Commit `refactor(trophies): drop the per-title memory and collapsed-row fallbacks`.

### Task D6: Publicar a fase (d)

- [ ] **Step 1:** Revisão do branch.
- [ ] **Step 2: Parar e mandar ao Lucas** a migration de limpeza (o que sai) e esperar o "ok".
- [ ] **Step 3:** Backup, `migrate deploy`, merge `--no-ff`, push e espera do Vercel.
- [ ] **Step 4:** Conferir no site:
  - `/jogos/ghost-of-yotei-digital-deluxe-edition` redireciona (308) para `/jogos/ghost-of-yotei`;
  - "Outras edições" aparece num par aprovado;
  - um sync PSN do diguzz termina sem reler as listas (`titles.read` baixo);
  - snapshot da Steam idêntico.
- [ ] **Step 5:** Resumo ao Lucas, incluindo o 308 × 301.

---

# Fase (e): etapa 7. Troféus para o catálogo inteiro

### Task E0: Decisão do Lucas

- [ ] **Step 1:** Mandar ao Lucas:
  - **a resposta medida:** a Sony entrega a lista sem conta de jogador, mas só se soubermos o id dela;
  - **o caminho:** varrer os ids `NPWR`, ~65 mil ids × até 2 pedidos, a ~1 pedido/s, em fatias de 1 h no GitHub Actions (~35 rodadas);
  - **o risco:** API não oficial; a conta de serviço pode ser bloqueada;
  - **o desenho:** índice leve no banco + troféus lidos ao abrir a página.
  
  Sem "sim", a parte PSN da fase (e) para aqui.
- [ ] **Step 2:** Rodar o spike do Xbox. Com a `XBOX_OPENXBL_KEY`, conferir:
  - se o OpenXBL dá as conquistas de um `titleId` sem jogador (rota de conquistas por título; conferir o caminho na documentação);
  - como achar o `titleId` de um jogo do catálogo (busca de marketplace do OpenXBL, ou `external_games` do IGDB).
  
  Se algum dos dois não existir, a parte Xbox para, e o Lucas é avisado.

### Task E1: Índice das listas da PSN (se aprovado)

**Files:**
- Modify: `schema.prisma`
  ```prisma
  model PsnCatalogList { id String @id /* npCommunicationId */; name String; console String?; serviceName String; trophyCount Int; tiers Json; matchedAt DateTime?; trophiesSyncedAt DateTime?; checkedAt DateTime @default(now()) }
  ```
- Create:
  - migration `20261111090000_psn_catalog`;
  - `app/src/lib/sync/psn-catalog.ts` (`scanPsnIds({ from, count, deadline })`: para cada `NPWRnnnnn_00`, pede `trophyGroups`, primeiro `trophy2` e depois `trophy`, um pedido por vez com pausa mínima de 1 s; a posição fica em `SyncCursor psn-catalog-scan`);
  - `matchPsnCatalog()`: liga ao jogo com o mesmo nome normalizado (único) **e** família PLAYSTATION. Cria `TrophyList` (sem troféus) e `GamePlatformLink`;
  - `app/scripts/psn-catalog-worker.ts`;
  - `.github/workflows/psn-catalog.yml` (horário ímpar sem sobreposição, conforme a tabela do `app/README.md`).
- Test: `psn-catalog.db.test.ts`. Casos:
  - `scan stores name console and counts`;
  - `scan resumes from the cursor`;
  - `match links only unique PlayStation names`;
  - `404 on both services is skipped`.

- [ ] **Step 1:** Escrever os testes (FAIL).
- [ ] **Step 2:** Implementar, PASS, commit `feat(psn): catalog index of trophy lists`.

### Task E2: Troféus lidos ao abrir a página

**Files:**
- Create: `app/src/lib/sync/psn-catalog-trophies.ts`, com `loadPsnCatalogTrophies(gameId): Promise<void>`. Ele pega para si a lista (`trophiesSyncedAt`, como em `retro-achievements.ts`), lê as definições e grava `Achievement` com `listId`, sem progresso de ninguém.
- Modify:
  - `app/src/app/jogos/[slug]/page.tsx`: chama `loadPsnCatalogTrophies` como já chama `getRetroAchievementsDue`, fora do caminho em cache;
  - `app/README.md`: worker e cota do Neon.
- Test: `psn-catalog-trophies.db.test.ts`. Casos:
  - `first open reads the definitions once`;
  - `concurrent opens read once`;
  - `a later player sync fills the same list without duplicating rows`.

- [ ] **Step 1:** Escrever os testes (FAIL).
- [ ] **Step 2:** Implementar, PASS, commit `feat(psn): trophy lists of games nobody on Tralked owns`.

### Task E3: Publicar a fase (e)

- [ ] **Step 1:** Rodar a suíte, `tsc`, `lint` e a revisão.
- [ ] **Step 2: Parar e mandar ao Lucas** a migration e o tamanho estimado do índice (~65 mil linhas, ~10 MB). Esperar o "ok".
- [ ] **Step 3:** Backup, `migrate deploy`, merge, push e espera do Vercel. Disparar o workflow uma vez.
- [ ] **Step 4:** Conferir que `/jogos/ghost-of-yotei` mostra a lista de troféus da PSN sem ninguém ter o jogo.
- [ ] **Step 5:** Atualizar as pendências em `docs/handoff-2026-11-02-tralked.md`:
  - itens 20–23 ficam resolvidos;
  - a pendência 4 fica resolvida;
  - entram os números finais.
  
  Depois, commit + merge.

---

## Ordem de execução e fases

| Fase | Tarefas, na ordem | Sobe para produção em |
|---|---|---|
| (a) | A1 → A2 → A6 → A3 → A4 → A5 → A7 → A8 → A9 → A10 → A11 | A11 |
| (b) | B0 (aprovação) → B1 → B2 → B3 → B4 | B4 |
| (c) | C1 → C2 → C3 → C4 (C3 usa o quadro 3 do mockup B0) | C4 |
| (d) | D1 → D2 (aprovação do relatório) → D3 → D4 → D5 → D6 | D4 e D6 |
| (e) | E0 (decisão) → E1 → E2 → E3 | E3 |

A6 vem antes de A3/A4 porque o sync passa a chamar `settleListXp`. O progresso fica em `.superpowers/sdd/2026-11-05-unificacao-trofeus/progress.md`, na raiz do worktree.
