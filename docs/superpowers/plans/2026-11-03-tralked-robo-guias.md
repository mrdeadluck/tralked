# Robô de Guias + página de detonado Tralked: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Lucas pede o guia de um jogo no admin. O robô pesquisa várias fontes de 100% (PowerPyx + fontes nativas da Steam), cruza os fatos, verifica que cobre 100% da lista Steam, escreve um detonado cronológico com a voz Tralked, monta as imagens e envia o guia para revisão. O site exibe o guia na página nova (revista, ficha, jornada, linha verde, fundo animado, trilha) com conferência de conquista na Steam e recompensa.

**Architecture:** Um contrato único, o "guia formato 2" (`walkthrough`), em zod no site e espelhado no robô (teste de contrato). O site ganha a API de pedidos, mídia, versão pendente e a página nova. O robô vive **dentro do projeto `ROBO NOTICIAS/`** (mesmo `package.json`, módulos compartilhados), mas com pasta `src/guias/`, banco SQLite próprio (`data-guias/guias.db`), config e comandos próprios. Assim um robô não derruba o outro e não há duas cópias de `zod`/SDK.

**Tech Stack:** Site: Next.js App Router, Prisma/Postgres, zod 4, vitest, Vercel Blob, sharp. Robô: Node 24 ESM, tsx, `@anthropic-ai/sdk` 1.3, zod 4, `node:sqlite`, `@mozilla/readability` + `linkedom`, sharp (novo), vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-tralked-robo-guias-design.md`. A página final está em `docs/superpowers/specs/2026-11-03-robo-guias/guia-final-v3.html` e é a **referência visual obrigatória** das tarefas de página. Os dados reais do Phantom Blade Zero que ela usa ficam em `exemplo-real.html`.

## Decisões do plano (o spec deixou para o builder)

- **Onde o robô mora:** `ROBO NOTICIAS/src/guias/**`, `ROBO NOTICIAS/test/guias/**`, comandos `pnpm guia` e `pnpm guia:pedido`, `DATA_DIR_GUIAS` padrão `./data-guias`.
- **Formato do detonado:** fica num JSON validado (`Guide.walkthrough`), não em tabelas por capítulo. O progresso do leitor é por **chave de item**, em `GuideItemProgress(userId, guideId, itemKey)`. As **etapas do roadmap** continuam sendo `GuideStep` (com `key` = chave da fase), o que reaproveita o progresso, o admin e o versionamento que já existem.
- **Uma migração só**, `20261107090000_guide_walkthrough`, feita na Tarefa 1. Nenhuma outra tarefa toca no `schema.prisma`.
- **Descoberta de fontes:** URLs determinísticas quando o padrão é conhecido (PowerPyx, guias da Comunidade Steam por appid). O resto vem da ferramenta de busca na web do lado do servidor da API da Claude. Consulte a skill `claude-api` para o nome e a versão atuais da ferramenta antes de codar.
- **Extração:** um extrator genérico com LLM (texto da página → fatos estruturados, em zod), não um parser por site.
- **Imagens:** imagem de terceiro **nunca é recortada**, só redimensionada, com as nossas marcações por cima. Assim a marca d'água da fonte sempre fica. Recorte só em screenshot oficial. O alvo das setas vem de uma chamada de visão ("onde está o item marcado nesta imagem?"). Se a resposta for nula, a imagem sai sem seta, só com a marca Tralked. O crédito e o link da fonte são texto do site, não vão gravados na imagem.
- **Trava de gasto:** teto por pedido, `GUIDE_BUDGET_USD` (padrão 25), por um adaptador de gasto. Ver a Tarefa 5.

## Global Constraints

- Vocabulário: **"Tralked" no lugar de "platina"** em todo texto ("Guia Tralked", "Tempo até o Tralked", "O caminho até o Tralked", "Tralked 100% offline", "TRALKED EM x h").
- Nomes: **PT-BR com o inglês entre parênteses na primeira menção**. Item ou lugar sem tradução oficial fica em inglês. Os nomes PT-BR das conquistas vêm do schema da Steam com `l=brazilian`.
- **A Steam é a lista-mestre.** Um guia por jogo (`Guide.gameId @unique` continua). O selo `compat` é `steam_only` | `psn_xbox` | `psn` | `xbox`.
- O robô **só envia guia que passou na porta de completude**. Se não passa: status `waiting_sources` e nova tentativa automática a cada 3 dias, por até 30 dias.
- Guia de robô sempre entra como `review`. A chave do robô **não** tem `publish`.
- Imagem de terceiro: nunca remover, cobrir ou recortar fora a marca d'água. Crédito e link da fonte sempre aparecem.
- Trilha sonora: só vídeo ou playlist oficial do YouTube (produtora, gravadora ou compositor), volume inicial **0.08**, começa no primeiro clique ou toque, nunca hospedada pelo Tralked.
- Visual: grafite + lima (`--acc #c6f432`), cantos chanfrados (`tk-cut*`), Archivo + JetBrains Mono. Nenhuma cor de destaque nova além do âmbar `--warn` (já usado nos mockups para perdível) e do azul de PSN `--ps` (já existe).
- `prefers-reduced-motion`: sem troca de fundo, sem parallax, sem animação da linha (ela aparece preenchida até o ponto atual).
- Robô: respeitar `robots.txt`; intervalo mínimo por host de 2 s (padrão) e 5 s (`steamcommunity.com`); página de desafio (Cloudflare/Anubis) = fonte não lida, nunca contornada.
- O XP só vem de conquista **confirmada pela Steam**. O check manual nunca dá XP.
- Testes do site: `DATABASE_URL=postgresql://gamelog:gamelog@localhost:5433/gamelog_test`, depois de `pnpm db:migrate` e `pnpm db:seed`. Tipos: `pnpm exec tsc --noEmit`. Testes do robô: `pnpm test` e `pnpm typecheck` dentro de `ROBO NOTICIAS/`.

## Review Focus

1. **Jogo com conquista oculta da Steam**: o `/dossie` atual omite as ocultas. O robô precisa receber **todas** (com `hidden: true`), senão a porta de completude aprova um guia sem elas (Tarefa 2: teste `dossie all=1 inclui ocultas`; Tarefa 7: teste `gate falha quando falta conquista oculta`).
2. **Atualização de guia já publicado**: hoje dá `409 published_locked`. Com o fluxo novo, o guia no ar **não pode mudar** até o admin aprovar (Tarefa 2: `PATCH em guia publicado cria pendente e não altera o guia`).
3. **Fonte copiada do PowerPyx contada como segunda fonte**: duas páginas quase iguais contam como uma (Tarefa 7: `fontes quase idênticas contam como uma`).
4. **Leitor sem Steam ligada ou com perfil privado marca uma conquista**: não pode quebrar nem dar XP. Vira checklist com o convite (Tarefa 10: `sem Steam ligada → status unlinked, nenhuma linha de XP`).
5. **Mudança de chave de item numa atualização**: as marcas dos leitores ficam presas à chave. Item removido perde só a sua marca, e item renomeado com a mesma chave mantém a marca (Tarefa 2: `itens com a mesma chave mantêm GuideItemProgress após PATCH aprovado`).

---

## Ondas de execução (para agentes em paralelo)

Cada tarefa roda num worktree próprio, a partir do branch de integração `feat/robo-guias`, e volta por merge depois da revisão. Dentro de uma onda as tarefas não tocam nos mesmos arquivos.

| Onda | Tarefas | Paralelo? |
|---|---|---|
| 0 | T1 (contrato + migração) | sozinha |
| 1 | T2, T3, T4 (site) · T5, T6 (robô) | as 5 em paralelo |
| 2 | T7, T8, T9 (robô) · T10, T11 (site) | as 5 em paralelo |
| 3 | T12 (página parte A) · T13 (pipeline do robô) | as 2 em paralelo |
| 4 | T14 (página parte B) | sozinha (mexe nos arquivos da T12) |
| 5 | T15 (ponta a ponta com o Phantom Blade Zero + docs) | sozinha |

---

### Task 1: Contrato do guia formato 2 + migração única

**Files:**
- Create: `app/src/lib/content/walkthrough-schema.ts`
- Create: `app/src/lib/content/walkthrough-schema.test.ts`
- Modify: `app/src/lib/content/guide-schema.ts` (o payload e o patch ganham `format` e `walkthrough`)
- Modify: `app/prisma/schema.prisma`; Create: `app/prisma/migrations/20261107090000_guide_walkthrough/migration.sql`
- Create: `ROBO NOTICIAS/src/guias/contract.ts`, `ROBO NOTICIAS/test/guias/contract.test.ts`, `ROBO NOTICIAS/test/guias/fixtures/walkthrough-pbz.json`
- Modify: `app/src/lib/api/idempotency.ts` (`IngestionKind` passa a ser `"article" | "guide" | "guide_request" | "media"`), `app/src/lib/api/errors.ts` (código `unsupported_media_type` → 415). Feito aqui para que T3 e T4 não editem o mesmo arquivo em paralelo.

**Interfaces:**
- Produces (site): `walkthroughSchema`, `type Walkthrough`, `type GuideCompat`, `type WalkChapter`, `type WalkStep`, `type WalkItem`, `WALK_ITEM_KINDS = ["collectible","achievement","mission","key_item","boss","other"] as const`, `GUIDE_COMPAT = ["steam_only","psn_xbox","psn","xbox"] as const`, `walkItemKeys(w: Walkthrough): string[]`, `walkAchievementRefs(w): { apiName: string; path: string }[]` (o caminho é JSON Pointer).
- Produces (Prisma):
  - `Guide`: `format Int @default(1)`, `walkthrough Json?`, `edition Int? @unique`, `compat String?`, `report Json?`;
  - `Achievement`: `namePt String?`, `descriptionPt String?`;
  - `GuideItemProgress { userId, guideId, itemKey String, createdAt }`, `@@id([userId, guideId, itemKey])`;
  - `GuidePendingUpdate { id, guideId, botKeyId String?, payload Json, createdAt }`, `@@index([guideId])`;
  - `GuideRequest { id, steamAppId Int, gameId String?, platform String @default("steam"), status String, priority Int @default(0), attempts Int @default(0), nextAttemptAt DateTime?, firstWaitingAt DateTime?, reason String?, report Json?, guideId String?, requestedById String?, createdAt, updatedAt }`, `@@index([status, priority, createdAt])`.

  Os status são documentados no comentário do cabeçalho do schema: `queued|researching|writing|review|published|waiting_sources|failed|cancelled`.
- Produces (robô): `contract.ts` exporta os tipos TS espelhados (`Walkthrough`, `WalkItem`, …) e `GuidePayloadV2` (o corpo do POST com `format: 2`).

Forma do `walkthrough` (os limites entram no zod):

```ts
{
  cover: { calls: [{ value: string /*≤8*/, label: string /*≤28*/ }] /*exatamente 3*/,
           sealHours: string /*≤12*/, headline: string /*≤60*/, deck: string /*≤90*/ },
  extraFacts: { buggedCount: int>=0, hardest: { apiName: string } | null,
                playthroughsNote: string /*≤120*/, difficultyNote: string /*≤160*/ },
  compat: GuideCompat,
  readFirst: [{ title /*≤60*/, text /*inline ≤400*/, tone: "aviso"|"info", spoiler: boolean }] /*1..8*/,
  chapters: [{ key, phaseKey /*= key de um steps[]*/, title /*≤80*/, region?: string, hours: string,
               sceneImage?: httpsUrl, deadline?: string /*≤200*/,
               steps: [{ key, body: ContentBlock[] /*1..20*/,
                         items: [{ key, kind: WalkItemKind, name /*≤80*/, nameEn?: string,
                                   collectibleType?: string, index?: int>=1, total?: int>=1,
                                   location?: string /*inline ≤400*/, missable: boolean, returnLater: boolean,
                                   spoiler: boolean, achievement?: string /*apiName steam*/,
                                   countsFor: string[] /*apiNames*/, alsoOn: ("psn"|"xbox")[],
                                   image?: { url: httpsUrl, credit: string, sourceName: string, sourceUrl?: httpsUrl },
                                   sources: [{ name, url }] /*min 1*/, review: boolean }] /*0..40*/ }] /*1..80*/ }] /*1..60*/,
  soundtrack?: { youtubeId?: string /*11*/, playlistId?: string, title: string, channel: string },
}
```

As chaves (`key`) usam o `STEP_KEY_PATTERN` que já existe e são únicas em todo o walkthrough (capítulos, passos e itens no mesmo espaço).

- [ ] **Step 1: Testes do schema** (`walkthrough-schema.test.ts`):
  - `aceita o fixture do Phantom Blade Zero`: o JSON da região 1 do `exemplo-real.html` (9 passos, com `compat: "steam_only"`);
  - `recusa chave repetida entre item e capítulo` → issue em `/chapters/0/steps/0/items/0/key`;
  - `recusa cover.calls com 2 itens`;
  - `item com index sem total é recusado`;
  - `walkAchievementRefs lista item.achievement e countsFor com caminho`;
  - `payload com format 2 sem walkthrough é recusado` (em `guidePayloadSchema`);
  - `format 1 continua aceito sem walkthrough` (o exemplo do Hollow Knight, `EXAMPLE_GUIDE`).
- [ ] **Step 2:** Rode `pnpm exec vitest run src/lib/content/walkthrough-schema.test.ts` e confira que FALHA.
- [ ] **Step 3:** Implemente o schema e os helpers. Adicione `format: z.union([z.literal(1), z.literal(2)]).default(1)` e `walkthrough: walkthroughSchema.optional()` em `guidePayloadSchema` e `guidePatchSchema`, com um `superRefine` que exige `walkthrough` quando `format === 2`.
- [ ] **Step 4:** Edite o Prisma e escreva o SQL da migração à mão, como as migrações recentes. Rode `pnpm db:migrate` no `gamelog_dev` e `prisma migrate deploy` no `gamelog_test`, depois `pnpm db:generate`.
- [ ] **Step 5:** Teste de contrato do robô (`ROBO NOTICIAS/test/guias/contract.test.ts`): importa `walkthroughSchema` pelo alias `@` (`@/lib/content/walkthrough-schema`) e valida `fixtures/walkthrough-pbz.json` (a mesma fixture, copiada). Confere também que `GuidePayloadV2` do robô é atribuível ao `z.input` do schema do site (teste de tipo com `expectTypeOf`).
- [ ] **Step 6:** Rode os testes dos dois lados e confira que PASSAM; rode `pnpm exec tsc --noEmit` (site) e `pnpm typecheck` (robô).
- [ ] **Step 7: Commit** com `feat(guias): walkthrough contract (format 2) and the guide-robot migration`.

---

### Task 2: API de guias formato 2, versão pendente e dossiê completo

**Files:**
- Modify: `app/src/lib/api/guides.ts`, `app/src/app/api/v1/guides/[id]/route.ts`, `app/src/lib/api/insights.ts` (dossiê), `app/src/app/api/v1/games/[slug]/dossie/route.ts`, `app/src/lib/api/openapi.ts`, `app/src/lib/api/examples.ts`
- Create: `app/src/lib/api/guide-pending.ts`, `app/src/lib/api/guides-v2.test.ts`
- Modify: `app/src/lib/admin/guides.ts`, `app/src/app/admin/guias/[id]/page.tsx`, `app/src/app/admin/guias/actions.ts` (aplicar ou descartar a pendente)

**Interfaces:**
- Consumes: T1 `walkthroughSchema`, `walkAchievementRefs`, `walkItemKeys`.
- Produces:
  - `createGuide`/`updateGuide` aceitam `format: 2`;
  - `queuePendingUpdate(tx, guideId, botKeyId, payload): Promise<{ pendingId: string }>`;
  - `applyPendingUpdate(pendingId, editorId): Promise<void>` e `discardPendingUpdate(pendingId)`;
  - a resposta do `PATCH` em guia publicado sem `publish` passa a ser **202** `{ id, status: "pending_review", pendingId }`;
  - `gameDossier(slug, { all: boolean })`: com `all`, inclui as ocultas, com `hidden`, `namePt` e `descriptionPt`;
  - `GET /api/v1/games/{slug}/dossie?all=1` exige o escopo `guides:write`.

Regras de validação do formato 2 (422 com o caminho exato):
- toda referência de `walkAchievementRefs` existe como conquista **steam** do jogo;
- **cobertura**: toda conquista Steam do jogo (ocultas incluídas) aparece pelo menos uma vez como `item.achievement`. Falta → 422 em `/walkthrough`, com mensagem listando os apiNames que faltam (até 20);
- `chapters[].phaseKey` existe em `steps[].key`, e `steps` exige `key` em todas as fases;
- `extraFacts.hardest.apiName` existe;
- `facts.missables` é igual ao número de itens com `missable && kind==="achievement"`;
- `extraFacts.buggedCount` não é validado (vem das fontes).

`Guide.edition` é atribuído na primeira publicação: `max(edition)+1`, dentro da transação de `setGuideStatus` quando passa para `published`.

- [ ] **Step 1: Testes** (`guides-v2.test.ts`, no padrão de `api.test.ts`: chave real com `createApiKey`, seed `hollow-knight` e um jogo de teste com uma conquista oculta):
  - `POST formato 2 válido cria guia em review com walkthrough e steps por fase`;
  - `POST formato 2 sem uma conquista oculta → 422 /walkthrough citando o apiName`;
  - `item.achievement inexistente → 422 /walkthrough/chapters/0/steps/1/items/0/achievement`;
  - `PATCH em guia publicado cria pendente e não altera o guia` (o `walkthrough` no banco continua igual; a resposta é 202);
  - `applyPendingUpdate aplica e salva GuideVersion` (`revision` +1);
  - `itens com a mesma chave mantêm GuideItemProgress após PATCH aprovado; item removido perde a marca`;
  - `dossie all=1 inclui ocultas` (com `hidden: true` e `namePt`);
  - `dossie all=1 sem guides:write → 403`;
  - `edition é atribuída na primeira publicação e não muda depois`.
- [ ] **Step 2:** Rode `pnpm exec vitest run src/lib/api/guides-v2.test.ts` e confira que FALHA.
- [ ] **Step 3:** Implemente: valide o `walkthrough` em `createGuide`/`updateGuide`. O snapshot do `saveGuideVersion` ganha `format` e `walkthrough`. Troque o `published_locked` por `queuePendingUpdate`. Ao aplicar uma pendente, apague o `GuideItemProgress` das chaves que sumiram.
- [ ] **Step 4:** No admin, a página `/admin/guias/[id]` mostra o **relatório do robô** (`Guide.report`: fontes lidas, divergências, fatos com uma fonte só, cobertura), o mesmo resumo em `/admin/revisao`, e a pendente (data e diff resumido: capítulos e itens adicionados ou removidos) com os botões "Aplicar" e "Descartar". Use `authorizeAction("staff", …)` e depois `updateTag(gameTag(slug))`.
- [ ] **Step 5:** Coloque `EXAMPLE_GUIDE_V2` em `examples.ts` (cópia do fixture) e no OpenAPI. O `docs.test.ts` precisa continuar passando.
- [ ] **Step 6:** Rode os testes da pasta `src/lib/api` e `tsc` e confira que PASSAM.
- [ ] **Step 7: Commit** com `feat(api): format-2 walkthrough guides, pending updates for published guides, full dossier`.

---

### Task 3: Fila de pedidos de guia (API + admin) e nomes PT-BR da Steam

**Files:**
- Create: `app/src/lib/guide-requests/queue.ts`, `app/src/lib/guide-requests/queue.test.ts`
- Create: `app/src/app/api/v1/guide-requests/next/route.ts`, `app/src/app/api/v1/guide-requests/[id]/route.ts`
- Create: `app/src/app/admin/guias/pedidos/page.tsx`, `app/src/app/admin/guias/pedidos/actions.ts`, `app/src/components/admin/GuideRequestForm.tsx`
- Modify: `app/src/lib/integrations/steam/types.ts`, `steam/client.ts`, `steam/community.ts`, `steam/fixture.ts` (`getSchemaForGame(appId, lang?: "english"|"brazilian")`)
- Modify: `app/src/lib/sync/catalog.ts` (`syncGame` preenche `namePt`/`descriptionPt` numa segunda leitura com `brazilian`), `app/src/lib/admin/dashboard.ts` (contagem de pedidos), `app/src/app/admin/layout.tsx` (link "Pedidos de guia")

**Interfaces:**
- Produces:
  - `createGuideRequest({ steamAppId, requestedById }): Promise<GuideRequest>`: chama `syncGame(steamAppId)`. Se o retorno for null (jogo sem conquistas), responde erro "sem conquistas na Steam". Se o jogo já tem guia, recusa. Se já existe pedido aberto do jogo, recusa;
  - `claimNextRequest(now): Promise<GuideRequest | null>`: atômico, pega `queued` por (`priority desc`, `createdAt asc`), ou `waiting_sources` com `nextAttemptAt <= now`, e passa para `researching`, `attempts+1`;
  - `reportRequest(id, { status, reason?, report?, guideId? }, now)`:
    - `waiting_sources` define `firstWaitingAt` (se vazio) e `nextAttemptAt = now + 3 dias`;
    - se `now - firstWaitingAt > 30 dias`, vira `failed` com o motivo "fontes insuficientes após 30 dias";
  - `retryNow(id)`, `cancelRequest(id)`, `bumpPriority(id, delta: 1|-1)`;
  - API:
    - `POST /api/v1/guide-requests/next` (escopo `guides:write`) → 200 `{ request: { id, steamAppId, gameSlug, attempts } }` ou 204;
    - `PATCH /api/v1/guide-requests/{id}` (escopo `guides:write`, com Idempotency-Key; reaproveite `handleWrite` com `kind: "guide_request"`, que já vem da T1) → 200.

- [ ] **Step 1: Testes** (`queue.test.ts`, DB real, Steam fixture):
  - `pedido de jogo sem conquistas é recusado`;
  - `segundo pedido aberto do mesmo jogo é recusado`;
  - `claimNextRequest respeita prioridade e depois a ordem de chegada`;
  - `claim simultâneo devolve o pedido uma vez só` (`Promise.all` de 2);
  - `waiting_sources volta em 3 dias e falha após 30`;
  - `syncGame grava namePt e descriptionPt` (o fixture Steam devolve nomes PT quando `lang==="brazilian"`);
  - `route next sem guides:write → 403`.
- [ ] **Step 2:** Rode e confira que FALHA.
- [ ] **Step 3:** Implemente. O claim atômico usa um `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *` via `prisma.$queryRaw`.
- [ ] **Step 4: Admin `/admin/guias/pedidos`** (`requireStaffPage()`, `instant = false`):
  - formulário: busca no catálogo, ou o appid da Steam colado;
  - tabela: jogo, status (rótulos PT: Na fila, Pesquisando, Escrevendo, Em revisão, Publicado, Aguardando fontes, Falhou, Cancelado), tentativas, próxima tentativa, motivo, link do guia;
  - botões: Prioridade ↑/↓, Tentar agora, Cancelar;
  - o relatório (`report`) abre num `<details>`.

  Siga o visual do admin (`ui.tsx`).
- [ ] **Step 5:** Rode os testes e `tsc` e confira que PASSAM.
- [ ] **Step 6: Commit** com `feat(guias): guide request queue (admin + bot API) and PT-BR Steam achievement names`.

---

### Task 4: Upload de mídia para robôs

**Files:**
- Create: `app/src/app/api/v1/media/route.ts`, `app/src/lib/api/media-upload.ts`, `app/src/lib/api/media-upload.test.ts`
- Modify: `app/src/lib/storage/blob.ts` e `app/src/lib/storage/index.ts` (prefixo como parâmetro; a galeria continua `galeria/`), `app/next.config.ts` (`images.remotePatterns` com o host do Blob), `app/src/components/admin/KeyCreator.tsx` e `app/src/app/desenvolvedores/page.tsx` (o rótulo do `media:write` deixa de ser "Reservado")

**Interfaces:**
- Produces: `POST /api/v1/media`
  - escopo `media:write`, `Idempotency-Key` obrigatório;
  - corpo binário cru com `Content-Type: image/png|image/jpeg|image/webp`, máximo **8 MiB** (lido com limite, sem `readJson`);
  - processa com `processImage` (WebP, até 2048 px) e grava com prefixo `guias/`;
  - responde 201 `{ url, width, height }`. Tipo errado → 415 `unsupported_media_type` (o código já vem da T1). Grande demais → 413.

- [ ] **Step 1: Testes:**
  - `PNG válido → 201 com url em guias/`: storage local em teste; confira que o arquivo existe;
  - `sem media:write → 403`;
  - `9 MiB → 413`;
  - `text/plain → 415`;
  - `mesmo Idempotency-Key e mesmo corpo devolve a mesma url` (o hash do corpo binário entra no `requestHash`).
- [ ] **Step 2:** Rode e confira que FALHA. **Step 3:** Implemente. **Step 4:** Rode e confira que PASSA, mais `tsc`.
- [ ] **Step 5: Commit** com `feat(api): media upload for bots (media:write)`.

---

### Task 5: Base do robô de guias (config, banco, busca educada, cliente da API)

**Files:**
- Create: `ROBO NOTICIAS/src/guias/config.ts`, `db.ts`, `polite-fetch.ts`, `api.ts`, `spend.ts`
- Modify: `ROBO NOTICIAS/src/ai/client.ts` (só o tipo: `createAi` aceita `db: Pick<Db, "spentToday"|"spentTotal"|"recordSpend">`), `ROBO NOTICIAS/src/pautas.ts` (exportar `isChallenge`)
- Create: `ROBO NOTICIAS/test/guias/{config,db,polite-fetch,api,spend}.test.ts`

**Interfaces:**
- Produces:
  - `loadGuideConfig(env): GuideConfig`, com:
    - `ANTHROPIC_API_KEY` (obrigatória);
    - `TRALKED_GUIDES_API_KEY` (obrigatória; escopos `guides:write` e `media:write`);
    - `TRALKED_API_URL` (padrão `https://tralked.com`);
    - `MODEL_WRITER` (padrão `claude-opus-5-5`), `MODEL_EXTRACT` (padrão `claude-sonnet-5-5`), `MODEL_FAST` (padrão `claude-haiku-5-5`);
    - `GUIDE_BUDGET_USD` (padrão 25);
    - `DATA_DIR_GUIAS` (padrão `./data-guias`);
    - `RESEND_API_KEY` e `ALERT_EMAIL` (opcionais).
  - `openGuideDb(dir): GuideDb`, com as tabelas:
    - `pages(url PK, fetched_at, status, final_url, text, html, content_hash)`;
    - `runs(request_id, attempt, started_at, finished_at, outcome)`;
    - `spend(at, request_id, purpose, model, usd)`;
    - `dossiers(request_id PK, json, updated_at)`;
    - `meta`;
    - `alerts`.
  - `guideSpend(db, requestId, capUsd)`: adaptador com `spentToday`, `spentTotal` e `recordSpend`. Ele compara o gasto **do pedido** com o teto e alimenta `createAi`, passando `{ DAILY_BUDGET_USD: capUsd, BACKFILL_BUDGET_USD: capUsd }`; o robô de guias usa sempre o bucket `"backfill"`.
  - `politeFetch(url, opts?): Promise<{ status: "ok"|"blocked"|"challenge"|"error"; text?: string; html?: string; finalUrl: string; reason?: string }>`:
    - lê o cache primeiro (validade de 7 dias);
    - `robots.txt` por host, cacheado; `Disallow` → `blocked`;
    - intervalo por host: 2 s padrão e 5 s para `steamcommunity.com`;
    - 429 → espera o `Retry-After` (máximo 120 s) e tenta uma vez;
    - `isChallenge` → `challenge`;
    - `USER_AGENT` de `collect/index.ts`.
  - `createGuideApi({ baseUrl, key, fetchFn })`, com os métodos:
    - `claimNext()`;
    - `reportRequest(id, body, idemKey)`;
    - `dossier(slug)`, que chama `?all=1`;
    - `media(slug)`;
    - `uploadImage(bytes, contentType, idemKey): Promise<{url}>`;
    - `createGuide(payload: GuidePayloadV2, idemKey)`;
    - `patchGuide(id, patch, idemKey)`;
    - `findGameByAppId(appId)`.

    Mesmo retry e mesmo `TralkedError` do `tralked.ts`: extraia o `call()` privado de lá para `src/tralked-http.ts` e reaproveite nos dois clientes, sem mudar o comportamento do robô de notícias.
- [ ] **Step 1: Testes** (padrão do robô: `fetchFn` falso em fila, relógio fixo, `openGuideDb(":memory:")`):
  - `robots Disallow bloqueia`;
  - `segunda busca no mesmo host espera 5 s em steamcommunity` (fake timers);
  - `cache de 7 dias evita nova requisição`;
  - `página Cloudflare vira challenge`;
  - `429 respeita Retry-After e tenta uma vez`;
  - `guideSpend estoura no teto do pedido e não conta outro pedido`;
  - `claimNext 204 → null`;
  - `uploadImage manda o corpo binário com Content-Type`;
  - `testes do tralked.ts continuam passando` (rode a suíte inteira).
- [ ] **Step 2:** Rode e confira que FALHA. **Step 3:** Implemente. **Step 4:** `pnpm test` e `pnpm typecheck` PASSAM.
- [ ] **Step 5: Commit** com `feat(robo-guias): config, own sqlite, polite fetch and guide API client`.

---

### Task 6: Descoberta de fontes e extração de fatos

**Files:**
- Create: `ROBO NOTICIAS/src/guias/sources.ts`, `discover.ts`, `extract.ts`, `facts.ts`
- Create: `ROBO NOTICIAS/prompts/guia-extracao.md`
- Create: `ROBO NOTICIAS/test/guias/{discover,extract}.test.ts`, fixtures `test/guias/fixtures/powerpyx-pbz-roadmap.html`, `powerpyx-pbz-weeping-creek.html`, `steam-guides-4115450.html` (baixe uma vez com `politeFetch` e salve)

**Interfaces:**
- Consumes: T5 `politeFetch`, `createAi`.
- Produces:
  - `SOURCE_ROLES = ["roteiro_psn","roteiro_steam","coletaveis","confirmacao"] as const`;
  - `type SourceRef = { name: string; url: string; role: SourceRole; language?: string }`;
  - `discoverSources(game: { name: string; steamAppId: number }, deps): Promise<SourceRef[]>`:
    - determinísticas:
      - PowerPyx `https://www.powerpyx.com/<slug>-trophy-guide-roadmap/`, mais os links de região/coletáveis achados na página do roadmap (`powerpyx.com/...-collectible-locations/`, `...-collectibles-guide...`);
      - guias Steam `https://steamcommunity.com/app/<appid>/guides/?browsefilter=toprated&requiredtags[]=Achievements`, de onde saem os **3** mais bem avaliados cujo título ou descrição fala em 100%/todas/all/全成就/все;
      - TrueSteamAchievements `https://www.truesteamachievements.com/game/<Nome-Com-Hifens>/achievements`;
    - por busca na web (ferramenta do servidor da API da Claude; até 6 buscas por pedido): PSNProfiles, Grindnstrat, Game8, IGN, games.gg, allthings.how, Fextralife/Fandom, Reddit;
  - `type ExtractedFacts`, em `facts.ts`, com zod `extractedFactsSchema`:
    - `{ source: SourceRef, chapters: [{ title, region?, order, items: [{ kind, name, nameEn?, collectibleType?, index?, total?, location, missable, missableUntil?, returnLater, achievementNameEn?, countsForEn: string[] }] }], achievements: [{ nameEn, howTo, missable, missableUntil?, bugged, bugNote?, online }], playthroughs?: { min: number, note }, difficulty?: { value: number, note }, hours?: { min, max }, roadmap?: [{ title, summary }], trophyListSize?: number, platform: "psn"|"steam"|"unknown", complete: boolean /*autor diz cobrir 100%, não é WIP*/ }`;
  - `extractFacts(page: { url, text, html }, source: SourceRef, deps): Promise<ExtractedFacts>`: um `ai.structured` com `MODEL_EXTRACT`, effort `medium`, o prompt `guia-extracao.md` e o texto inteiro. Páginas grandes vão em partes de 60k caracteres, juntadas na ordem.
- [ ] **Step 1: Testes** (Ai falso no padrão de `writer-checker.test.ts`; busca na web falsa):
  - `discover monta a URL do PowerPyx a partir do nome` ("Phantom Blade Zero" → `phantom-blade-zero-trophy-guide-roadmap`);
  - `discover pega os links de região da página do roadmap` (a fixture traz as 9 regiões);
  - `discover escolhe os 3 guias Steam que dizem 100%` (a fixture);
  - `discover limita a 6 buscas na web`;
  - `extract divide página grande em partes e mantém a ordem dos capítulos`;
  - `extract marca platform psn quando a página fala em PS5/troféus e trophyListSize 36` (a resposta falsa do Ai é validada pelo schema).
- [ ] **Step 2:** FALHA. **Step 3:** Implemente o código e o prompt. O prompt pede: só o que está escrito, sem inventar; manter a ordem da página; nomes em inglês como aparecem; `missableUntil` com o marco do jogo ("Crimson Forest main boss"). **Step 4:** PASSA.
- [ ] **Step 5: Commit** com `feat(robo-guias): source discovery and LLM fact extraction`.

---

### Task 7: Cruzamento, casamento PSN↔Steam e porta de completude

**Files:**
- Create: `ROBO NOTICIAS/src/guias/crossref.ts`, `match.ts`, `gate.ts`, `dossier.ts`
- Create: `ROBO NOTICIAS/test/guias/{crossref,match,gate}.test.ts`

**Interfaces:**
- Consumes: T6 `ExtractedFacts`; T5 `dossier(slug)` do site (lista Steam completa).
- Produces:
  - `independentGroups(pages: { url: string; text: string }[]): string[][]`: shingles de 5 palavras e Jaccard ≥ 0.6, que define "mesma fonte";
  - `matchAchievements(steam: { apiName; name; nameEn?; description? }[], other: { nameEn; description? }[]): { apiName: string; matched: boolean }[]`: normalização (minúsculas, sem pontuação nem acento, `&`→`and`, aspas tipográficas) e igualdade exata do nome. Sem casamento exato: similaridade ≥ 0.9 do nome **e** descrição compatível;
  - `computeCompat(steamCount, lists: { platform: "psn"|"xbox"; matchedAll: boolean; size: number }[]): GuideCompat`;
  - `type GuideDossier = { chapters: DossierChapter[]; achievements: DossierAchievement[]; facts: …; divergences: string[]; unreadSources: { name; url; reason }[] }`, em que cada fato carrega `sources: string[]` (nomes dos grupos independentes) e `agreed: boolean` (≥ 2 grupos);
  - `buildDossier(steamList, facts: ExtractedFacts[], groups): GuideDossier`: alinha os itens por (capítulo normalizado, tipo, índice) e, sem índice, por nome. Para coletáveis de fragmento, usa a regra das fontes (ex.: "4 fragmentos = 1 âmbar", quando alguma fonte disser);
  - `gate(d: GuideDossier, steamList): { ok: boolean; missing: string[] }`. Falha quando:
    - (a) alguma conquista Steam (ocultas incluídas) não tem item com fonte;
    - (b) uma conquista exclusiva da Steam (`matched=false` contra a lista PSN) não tem fonte com `platform: "steam"`;
    - (c) a contagem de uma conquista "colete N" não fecha: os itens do tipo, convertidos por fragmento quando houver regra, não somam N;
    - (d) um perdível não tem um marco `missableUntil` associável a um capítulo;
    - (e) a única fonte de roteiro tem `complete: false`.

    As mensagens de `missing` são em PT-BR, uma frase por falta.
- [ ] **Step 1: Testes** (fixtures pequenas escritas à mão com os dados reais do exemplo):
  - `fontes quase idênticas contam como uma`;
  - `item em 2 grupos fica agreed`;
  - `item só no PowerPyx fica com uma fonte`;
  - `"With Heart and Blood" casa com ACH_013` (os nomes EN do schema);
  - `30 conquistas de arma sem fonte steam → gate falha com 30 linhas`;
  - `gate falha quando falta conquista oculta`;
  - `contagem Blackstone 9 de 10 → gate falha`;
  - `perdível sem marco → gate falha`;
  - `compat: steam 66, psn 36 → steam_only; listas iguais psn+xbox → psn_xbox`;
  - `PowerPyx diz 23 sinos e lista 22 → divergência registrada` (a divergência não reprova sozinha).
- [ ] **Step 2:** FALHA. **Step 3:** Implemente (código puro, sem IA). **Step 4:** PASSA.
- [ ] **Step 5: Commit** com `feat(robo-guias): cross-reference, PSN-Steam matching and completeness gate`.

---

### Task 8: Escritor e checador do guia

**Files:**
- Create: `ROBO NOTICIAS/src/guias/writer.ts`, `checker.ts`, `ROBO NOTICIAS/prompts/guia-estilo.md`
- Create: `ROBO NOTICIAS/test/guias/writer.test.ts`

**Interfaces:**
- Consumes: T7 `GuideDossier`; T1 `Walkthrough`/`GuidePayloadV2`.
- Produces:
  - `writeGuide(ai, dossier, game, bucket): Promise<GuidePayloadV2>` (`MODEL_WRITER`, effort `high`): o modelo devolve o payload sem imagens (`image` vazio) e sem `soundtrack`. As chaves de capítulo, passo e item são **geradas pelo código** a partir do dossiê (`slugify` do título + índice), nunca pelo modelo, para ficarem estáveis entre execuções. O prompt recebe as chaves prontas;
  - `checkGuide(ai, payload, dossier): Promise<{ ok: boolean; problems: string[] }>` (`MODEL_FAST`, effort `low`);
  - `writeAndCheckGuide(...)`: escreve, checa, reescreve uma vez com os problemas e checa de novo. Se falhar de novo, o pedido vai para `failed`.

  O `guia-estilo.md` leva:
  - a voz Tralked do `estilo.md`;
  - o vocabulário "Tralked";
  - PT-BR + (inglês) na primeira menção, com os nomes PT oficiais das conquistas tirados de `namePt`;
  - texto próprio, sem copiar frase de fonte (máximo de 8 palavras seguidas iguais);
  - spoiler marcado (`spoiler: true`) em chefe, reviravolta e conquista oculta;
  - o aviso de perdível sempre **antes** do ponto de não retorno;
  - "dá para voltar depois" quando `returnLater`;
  - a capa: 3 chamadas tiradas da ficha (perdíveis quando > 0; "0 online" quando for diferencial; número de capítulos ou regiões);
  - `item.review = true` para todo fato com uma fonte só.
- [ ] **Step 1: Testes** (Ai falso):
  - `as chaves vêm do código e se repetem entre duas execuções`;
  - `o payload devolvido passa no walkthroughSchema do site` (alias `@`);
  - `item com uma fonte sai com review true`;
  - `reescreve uma vez com os problemas do checador`;
  - `verificador de cópia: frase de 9 palavras igual à fonte → problema`. Esse teste é **determinístico**: implemente `copiedRuns(text, sources, 9)` em `writer.ts` e rode-o antes do checador LLM.
- [ ] **Step 2:** FALHA. **Step 3:** Implemente. **Step 4:** PASSA.
- [ ] **Step 5: Commit** com `feat(robo-guias): Tralked-voice guide writer and checker`.

---

### Task 9: Imagens (montagem + localização) e trilha sonora

**Files:**
- Modify: `ROBO NOTICIAS/package.json` (adicionar `sharp`, na mesma major do site)
- Create: `ROBO NOTICIAS/src/guias/images.ts`, `locate.ts`, `soundtrack.ts`, `ROBO NOTICIAS/assets/tralked-wordmark.svg`
- Create: `ROBO NOTICIAS/test/guias/{images,soundtrack}.test.ts`, `test/guias/fixtures/map-sample.jpg`

**Interfaces:**
- Produces:
  - `pickItemImage(item, pages): { url: string; sourceName: string; sourceUrl: string; thirdParty: boolean } | null`: imagens `<img>` do bloco do item na página de fonte (pelo HTML guardado), com preferência por wiki/guia Steam e o PowerPyx por último, quando houver dúvida (regra do Lucas);
  - `locateTarget(ai, imageBytes, itemName): Promise<{ x: number; y: number; r: number } | null>`: visão, coordenadas normalizadas de 0 a 1, `MODEL_FAST`;
  - `composeImage(bytes, { target, thirdParty, crop? }): Promise<Buffer>` (WebP):
    - terceiro → **só redimensiona** para 1600 px de largura, nunca recorta;
    - oficial → pode recortar `crop`;
    - desenha um anel lima de 4 px no alvo e uma seta curta vindo do canto mais vazio;
    - grava a marca `TRALKED` no canto inferior direito, com 55% de opacidade;
  - `findSoundtrack(ai, game: { name; developer; publisher }, deps): Promise<{ youtubeId?; playlistId?; title; channel } | null>`: busca na web por "<nome> official soundtrack/OST". Aceita só quando o canal casa com a produtora, a publicadora, a gravadora ou o compositor. Na dúvida, `null`.
- [ ] **Step 1: Testes:**
  - `terceiro nunca é recortado` (as proporções de saída são iguais às de entrada);
  - `oficial com crop recorta`;
  - `sem alvo não desenha anel` (compare pixels da região central com a entrada redimensionada);
  - `marca TRALKED presente` (pixel claro no canto inferior direito);
  - `trilha de canal não oficial → null`;
  - `trilha do canal da publicadora → youtubeId`.
- [ ] **Step 2:** FALHA. **Step 3:** Implemente. **Step 4:** PASSA.
- [ ] **Step 5: Commit** com `feat(robo-guias): item images (overlay, watermark, locate) and official soundtrack finder`.

---

### Task 10: Conferência de um jogo na Steam, progresso por item e recompensa

**Files:**
- Modify: `app/src/lib/sync/user.ts` (extrair a sincronização de um jogo para `syncUserGame`)
- Create: `app/src/lib/sync/game-check.ts`, `app/src/lib/sync/game-check.test.ts`
- Modify: `app/src/app/jogos/[slug]/guia/actions.ts` (`toggleItem`, `checkGameAchievements`)

**Interfaces:**
- Produces:
  - `syncUserGame(userId, appId, now?): Promise<{ status: "ok"|"private"|"unlinked"; newUnlocks: string[] /*apiNames*/ }>`: reaproveita `fetchGame` e `recordGame` (mesma transação, mesma antifraude, mesmo ledger), depois `recomputeUser`. **Sem** o `claimSyncSlot` de 2 min;
  - `claimGameCheckSlot(userId, now): Promise<boolean>`: no máximo 1 conferência a cada 15 s por usuário, com `SyncCursor` de chave `game-check:<userId>` e update atômico;
  - server actions:
    - `toggleItem(guideId, itemKey): Promise<{ status: "ok"; done: boolean } | { status: "unauthenticated" | "not_found" }>`: a chave precisa existir no `walkthrough` publicado;
    - `checkGameAchievements(gameId): Promise<{ status: "ok"|"private"|"unlinked"|"cooldown"; newUnlocks: { apiName; name; iconUrl }[]; reward: Reward | null }>`: monta o `Reward` com `rewardOf`, no mesmo formato que o `syncNow` usa.
- [ ] **Step 1: Testes** (`vi.mock("@/lib/integrations")` com SteamApi falso, como em `user.test.ts`):
  - `nova conquista do jogo vira UserAchievement e XpLedgerEntry`;
  - `não lê outros jogos da biblioteca` (o espião de `getPlayerAchievements` só recebe o appid);
  - `sem Steam ligada → status unlinked, nenhuma linha de XP`;
  - `perfil privado → private`;
  - `segunda conferência em 10 s → cooldown`;
  - `unlock em rajada fica suspicious e sem XP` (a regra que já existe vale aqui);
  - `toggleItem com chave inexistente → not_found`;
  - `toggleItem liga e desliga`.
- [ ] **Step 2:** FALHA. **Step 3:** Implemente (refatorar sem mudar o `syncUser`; os testes de `user.test.ts` continuam passando). **Step 4:** PASSA, mais `tsc`.
- [ ] **Step 5: Commit** com `feat(guias): single-game Steam check with reward and per-item progress`.

---

### Task 11: Página de guia "só conquistas" para jogo sem guia

**Files:**
- Modify: `app/src/app/jogos/[slug]/guia/page.tsx` (sem guia e jogo com conquistas → renderiza em vez de redirecionar)
- Create: `app/src/components/guide/AchievementsOnly.tsx`, `app/src/lib/queries/achievements-only.ts`, `.test.ts`

**Interfaces:**
- Produces: `getAchievementsOnly(slug): Promise<{ game: GameDetail; lists: { platform: "steam"|"psn"|"xbox"|"retro"; achievements: { name; description; iconUrl; globalPct; hidden }[] }[] } | null>`, que devolve `null` quando o jogo não tem nenhuma conquista no banco (aí continua o redirect atual).
- [ ] **Step 1: Testes:** `jogo sem guia com conquistas steam e psn devolve as duas listas`; `jogo sem conquistas → null`; e um teste de componente (`.test.tsx`): `ocultas aparecem borradas com "mostrar"`.
- [ ] **Step 2:** FALHA. **Step 3:** Implemente com o visual do guia atual (cabeçalho `GameHead`, abas por plataforma, linha por conquista como o `AchievementItem`) e um aviso "Este jogo ainda não tem Guia Tralked". **Step 4:** PASSA.
- [ ] **Step 5: Commit** com `feat(guias): achievements-only guide page for games without a guide`.

---

### Task 12: Página do detonado, parte A (topo)

**Referência visual:** `guia-final-v3.html`, da capa até o roadmap e a coluna lateral.

**Files:**
- Modify: `app/src/app/jogos/[slug]/guia/page.tsx` (`format === 2` → `WalkthroughPage`; formato 1 continua como está)
- Modify: `app/src/lib/queries/games.ts` (`GuideDetail` ganha `format`, `walkthrough`, `edition`, `compat`, `report` só para staff; `applyGuideUserState` ganha `itemsDone: Set<string>`)
- Create em `app/src/components/guide/walk/`: `WalkthroughPage.tsx`, `MagazineCover.tsx`, `GuideHero.tsx`, `FichaGrid.tsx`, `ReadFirst.tsx`, `PhaseRoadmap.tsx`, `CompatSeal.tsx`, `WalkSidebar.tsx`, `walk.css` (ou utilitários Tailwind; siga o padrão do resto do guia)
- Test: `app/src/components/guide/walk/top.test.tsx`

**Interfaces:**
- Consumes: T1 tipos; T2 `edition`.
- Produces:
  - `WalkthroughPage({ guide, viewer })`: renderiza o topo e reserva `<WalkJourney/>` e `<WalkChapters/>` (implementados na T14). Nesta tarefa, eles são stubs que renderizam a lista simples de capítulos;
  - `MagazineCover({ game, edition, cover })`: o logotipo é SVG `<text textLength>` para nunca cortar;
  - `FichaGrid`: os 8 campos do spec, mais o XP do guia (`totals.xp`).

Regras da página:
- a capa usa a arte vertical oficial: a primeira imagem `GameMedia` de `kind: "cover"`, senão `coverUrl`;
- o fundo do hero é `heroUrl`;
- o nome da conquista "mais difícil" fica borrado enquanto os spoilers estiverem desligados;
- o selo de compat mostra:
  - `steam_only` → "APENAS STEAM" mais "Steam tem N; o PS5 tem M" quando o `report` trouxer os números;
  - `psn_xbox` → "COMPATÍVEL COM PSN E XBOX";
  - `psn` → "COMPATÍVEL COM PSN";
  - `xbox` → "COMPATÍVEL COM XBOX".
- [ ] **Step 1: Testes** (jsdom, com o fixture do PBZ):
  - `capa mostra TRALKED, Edição #001, 3 chamadas e selo TRALKED EM`;
  - `nenhum texto da página contém "platina"` (`/platina/i` no `textContent`);
  - `ficha tem 8 campos e "Tempo até o Tralked"`;
  - `mais difícil borrado sem spoilers`;
  - `selo APENAS STEAM`;
  - `formato 1 continua renderizando o guia antigo` (página com o seed `hollow-knight`).
- [ ] **Step 2:** FALHA. **Step 3:** Implemente seguindo o mockup. **Step 4:** PASSA, mais `pnpm lint` e `tsc`.
- [ ] **Step 5: Commit** com `feat(guia): walkthrough page top (magazine cover, ficha, read-first, roadmap)`.

---

### Task 13: Pipeline do robô, comandos e agendador

**Files:**
- Create: `ROBO NOTICIAS/src/guias/pipeline.ts`, `report.ts`, `ROBO NOTICIAS/src/commands/guia.ts`, `ROBO NOTICIAS/scripts/instalar-tarefa-guias.ps1`
- Modify: `ROBO NOTICIAS/package.json` (scripts `guia` e `guia:pedido`), `ROBO NOTICIAS/README.md` (seção "Robô de Guias"), `.gitignore` (`data-guias/`)
- Create: `ROBO NOTICIAS/test/guias/pipeline.test.ts`

**Interfaces:**
- Consumes: T5–T9 inteiras; T3 API de pedidos; T4 upload.
- Produces:
  - `runGuideRequest(deps): Promise<"idle"|"review"|"waiting_sources"|"failed">`. Sequência:
    1. `claimNext`;
    2. `dossier`;
    3. `discoverSources`;
    4. `politeFetch` de cada fonte;
    5. `extractFacts`;
    6. `independentGroups` e `buildDossier`;
    7. `gate`. Se falhar → `reportRequest(waiting_sources, report)`;
    8. `writeAndCheckGuide`;
    9. imagens: `pickItemImage`, `locateTarget`, `composeImage`, `uploadImage`;
    10. `findSoundtrack`;
    11. `createGuide`, ou `patchGuide` se o jogo já tiver guia do robô;
    12. `reportRequest(review, guideId)`.

    Atualiza o status `writing` antes do passo 8. `BudgetExceededError` vira `failed` com o motivo "teto de gasto". Erro inesperado vira `failed` com a mensagem, e a mesma `requestId` nunca fica presa em `researching`: use `try/finally`.
  - `buildReport(...)`: `{ sourcesRead: [{ name, url, ok, reason? }], divergences: string[], singleSource: string[], coverage: { steam: number; covered: number; steamOnly: number }, spendUsd: number }`. Ele vai junto no `report` do pedido e do guia.
  - `pnpm guia`: processa **um** pedido, com lock em `data-guias/guia.lock` (o `acquireLock` atual, stale 3 h). Sem pedido → linha "nada na fila".
  - `pnpm guia:pedido -- --appid <n>` é só um atalho de teste local que cria o pedido pela API de admin. Se isso exigir sessão, **omita o atalho** e documente o uso do admin.
  - Agendador: "Tralked Robo - Guias", a cada 30 min, `-MultipleInstances IgnoreNew`, limite de 3 h, log próprio `data-guias\logs\agendador-guias.log`, com `-Remover`. Mesma estrutura do `instalar-tarefas.ps1`.
- [ ] **Step 1: Testes** (todas as dependências falsas, como em `pipeline.test.ts`):
  - `fila vazia → idle`;
  - `gate falha → waiting_sources com report e nada enviado`;
  - `caminho feliz envia guia formato 2 em review e reporta review com guideId`;
  - `teto de gasto → failed`;
  - `erro no meio nunca deixa o pedido em researching`;
  - `jogo com guia do robô usa patchGuide`.
- [ ] **Step 2:** FALHA. **Step 3:** Implemente. **Step 4:** PASSA, mais `pnpm typecheck`.
- [ ] **Step 5: Commit** com `feat(robo-guias): request pipeline, report, CLI and Windows scheduler`.

---

### Task 14: Página do detonado, parte B (jornada, capítulos, linha verde, fundo, trilha, relatório)

**Referência visual:** `guia-final-v3.html`, da jornada até o relatório, mais o player.

**Files:**
- Create em `app/src/components/guide/walk/`: `WalkJourney.tsx` (client: grande + barra fina presa no topo), `WalkChapters.tsx`, `ChapterScene.tsx`, `WalkStepView.tsx`, `WalkItemRow.tsx` (client), `GreenTrail.tsx` (client), `BackdropFader.tsx` (client), `SoundtrackPlayer.tsx` (client), `SpoilerToggle.tsx` (client; contexto compartilhado com a T12), `RobotReport.tsx` (só staff)
- Modify: `WalkthroughPage.tsx` (troca os stubs)
- Test: `app/src/components/guide/walk/chapters.test.tsx`

**Interfaces:**
- Consumes: T10 `toggleItem`, `checkGameAchievements`; `announceReward` de `src/components/fx/reward-bus.ts`.

Comportamento:
- **`WalkItemRow`**:
  - selos: "dá para voltar depois", "perdível · pegue agora", "coletável n/N", "também no PS5/Xbox" (de `alsoOn`), "✓ 2 fontes" / "● 1 fonte · em revisão" (`review`);
  - imagem com o crédito "Imagem: <sourceName>" e o link `sourceUrl`;
  - marcar uma conquista chama `toggleItem` (otimista) e depois `checkGameAchievements`:
    - `ok` com o apiName em `newUnlocks` → `announceReward` ("TRALKED!" + XP);
    - `ok` sem o apiName → status "marcada por você · a Steam ainda não mostrou", e a página tenta de novo em 30 s e 90 s;
    - `unlinked`/`private` → convite "Ligue sua Steam para conferir".
- **`GreenTrail`**: linha de 2 px, `--acc` com brilho. O preenchimento acompanha 55% da altura da janela e os losangos dos passos acendem ao passar. `requestAnimationFrame`, listener `passive`.
- **`BackdropFader`**: até 4 screenshots (`GameMedia kind screenshot`), filtro `brightness(.42) saturate(.8) blur(1px)`, troca com fade de 1.4 s conforme a fração da rolagem, parallax de até 70 px. `prefers-reduced-motion` → só a primeira imagem, sem movimento.
- **`SoundtrackPlayer`**:
  - só aparece com `walkthrough.soundtrack`;
  - usa o YouTube IFrame API (`youtube-nocookie`) e só cria o player no **primeiro clique ou tecla** na página;
  - `setVolume(8)`;
  - botões pausar/tocar, volume e fechar;
  - o estado (fechado, volume) fica no `localStorage` dentro de `try/catch`;
  - no celular não toca sozinho: fica o botão ▶.
- **`RobotReport`**: só para staff, no fim da página: fontes lidas, divergências, fatos com uma fonte só e cobertura.
- [ ] **Step 1: Testes** (jsdom; mocks das actions):
  - `marcar conquista confirmada chama announceReward`;
  - `conquista não confirmada mostra aguardando e agenda nova conferência` (fake timers 30 s);
  - `unlinked mostra convite`;
  - `item perdível mostra selo e o aviso vem antes do passo` (ordem no DOM);
  - `player não cria iframe antes do primeiro clique e usa volume 8`;
  - `reduced motion: BackdropFader sem troca` (`matchMedia` falso);
  - `RobotReport não aparece para visitante`;
  - `nenhum texto contém "platina"`.
- [ ] **Step 2:** FALHA. **Step 3:** Implemente seguindo o mockup. **Step 4:** PASSA, mais `pnpm lint` e `tsc`.
- [ ] **Step 5:** Abra `/jogos/<slug-de-teste>/guia` no `pnpm dev`, com um guia formato 2 semeado pelo fixture, e compare lado a lado com `guia-final-v3.html` em 1300 px e 390 px. Anote as diferenças e corrija.
- [ ] **Step 6: Commit** com `feat(guia): walkthrough chapters, green trail, animated backdrop, soundtrack and reward`.

---

### Task 15: Ponta a ponta com o Phantom Blade Zero, documentação e entrega

**Files:**
- Modify: `docs/robos.md` (formato 2, pedidos, mídia, `dossie?all=1`, 202 pendente; os exemplos `<!-- exemplo:guia-v2 -->` validados pelo `docs.test.ts`), `app/src/app/desenvolvedores/page.tsx` (mesmo conteúdo)
- Modify: `ROBO NOTICIAS/README.md`

- [ ] **Step 1:** Com o site local (`pnpm dev` + `gamelog_dev`), crie uma chave com `guides:write` e `media:write` (sem `publish`), coloque em `ROBO NOTICIAS/.env` como `TRALKED_GUIDES_API_KEY` com `TRALKED_API_URL=http://localhost:3000` e peça o guia do appid **4115450** no admin.
- [ ] **Step 2:** Rode `pnpm guia` em `ROBO NOTICIAS/`. Resultado esperado:
  - **ou** `review`: o guia aparece em `/admin/revisao`, a página `/jogos/phantom-blade-zero/guia` (pré-visualização de staff) renderiza, e a cobertura do relatório é 66/66;
  - **ou** `waiting_sources`, com um relatório que lista exatamente o que falta.

  Os dois são resultados válidos. Registre qual saiu, o gasto (`spendUsd`) e o tempo.
- [ ] **Step 3:** Se saiu `review`: confira à mão 10 itens sorteados contra o PowerPyx e um guia Steam (local, perdível, contagem). Anote no ledger.
- [ ] **Step 4:** Atualize a documentação e rode `pnpm exec vitest run src/lib/api/docs.test.ts`. Deve PASSAR.
- [ ] **Step 5: Commit** com `docs(guias): bot guide format 2, requests and media in the robot docs`.
- [ ] **Step 6:** **Não** publique nem faça deploy. Deixe para o Lucas: revisar o guia no admin, decidir o deploy (push do `main` = deploy) e instalar o agendador com `scripts/instalar-tarefa-guias.ps1`.
