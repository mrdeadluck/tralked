# Robô de Notícias: Claude Code, mídia certa e variedade (plano de implementação)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fazer o robô escrever pelo Claude Code do PC do Lucas e publicar matérias com a imagem, o vídeo e o post do X certos, numa mistura variada de assuntos, com leve puxão para Steam e PC e presença garantida da Nintendo.

**Architecture:** o robô (`ROBO NOTICIAS/`, Node 24 + TypeScript + SQLite) ganha:
- outro motor de IA atrás da interface `Ai` existente, que roda `claude -p` com entrada e saída `stream-json`;
- um módulo `src/media/` que lê a mídia das páginas das fontes, escolhe e confere as imagens e envia a escolhida para o site;
- uma seleção por mistura no `publica`.

O site (`app/`, Next.js 16) ganha:
- o bloco `post` (X);
- o crédito clicável;
- o link de reserva no vídeo;
- um acervo oficial de consoles e empresas no lugar da arte de "um jogo qualquer da empresa".

**Tech Stack:**
- robô: Node 24, TypeScript, vitest, zod 4, linkedom, sharp, `node:sqlite`;
- site: Next.js 16, React 19, zod 4, vitest (projetos node e jsdom);
- Claude Code CLI 2.1.318 (instalado em `C:\Users\luck_\.local\bin\claude`).

**Spec:** `docs/superpowers/specs/2026-11-05-robo-noticias-midia-variedade-design.md` (aprovada pelo Lucas em 05/11/2026). Quem executa lê as duas.

## Global Constraints

- **Worktree:** `C:\projetos\tralked-robo-midia`, branch `feat/robo-midia`, a partir de `origin/main`.
  - Nunca editar `C:\projetos\tralked-steam-recentes`: a `main` está em uso lá.
  - Nunca editar os worktrees `tralked-tl-*`, `tralked-trophy-lists`, `tralked-robo-guias` e `rg-wt/*`.
- **Fronteira com os agentes dos troféus.** No site, só se mexe em:
  - `app/src/lib/content/` (`schema.ts`, `render.tsx`);
  - `app/src/components/content/` (novo);
  - `app/src/lib/admin/block-draft.ts` e `app/src/components/admin/BlockEditor.tsx`, só o necessário para o bloco novo;
  - `app/src/lib/queries/company-art.ts` e `app/src/lib/queries/news.ts`;
  - `app/src/app/privacidade/page.tsx`;
  - `app/public/acervo/` (novo).

  Nada de jogos, conquistas, sincronização, perfil ou busca.
- **Testes:**
  - robô: `cd "ROBO NOTICIAS" && pnpm test && pnpm typecheck`;
  - site: `cd app && pnpm test && pnpm typecheck && pnpm lint`. O site usa o banco de teste `postgresql://gamelog:gamelog@localhost:5433/gamelog_test`.
  - Suíte inteira verde antes de cada commit de tarefa.
- **Claude Code:** sempre tirar `ANTHROPIC_API_KEY` e `ANTHROPIC_AUTH_TOKEN` do ambiente do processo filho. Com elas presentes, o `-p` cobra da API em vez da assinatura. Nunca usar `--bare`, que ignora o login da assinatura. Nunca usar `--dangerously-skip-permissions`.
- **Limites que continuam:**
  - `MAX_PER_DAY` = 15;
  - `MAX_VIDEO_STORIES_PER_DAY` = 4;
  - pautas: `MAX_PAUTAS_PER_DAY` = 2, nota abaixo de 60, horário das 20h;
  - `NEWS_MAX_AGE_HOURS` = 12;
  - `PUBLISH_GAP_MINUTES` = 21.
- **Sem retroativo:** nada novo em `backfill.ts`. Com o motor `claude-code`, `batchRequest` lança erro claro ("retroativo desligado").
- **Imagens:**
  - só https;
  - sempre reenviadas ao site (`POST /api/v1/media`, escopo `media:write`) e nunca apontando para o servidor da fonte;
  - crédito no formato "Divulgação/<Empresa>", ou "Divulgação/<Empresa>, via <Veículo>", ou "Divulgação, via <Veículo>", sempre com `creditUrl` da página de origem.
- **Escrita no banco de produção** (escopo da chave): só pelo Lucas, com o comando que eu entrego.
- **Commits:** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A fonte não tem nenhuma imagem utilizável** (Itch.io, notícias de celular, só com `og:image` de logo do site): a matéria sai sem imagem no corpo, e o site usa o acervo ou a capa de reserva, nunca arte de outro jogo. Teste em A5 e A7.
2. **Limite da assinatura atingido no meio de uma rodada:** o robô para limpo, a história volta para a fila e sai um alerta "limite da assinatura", sem perder matéria nem publicar pela metade. Teste em 0.2.
3. **Página da fonte com post do X de fã ou de perfil de vazamento:** só entra se a história for rumor. Teste em A9.
4. **Vídeo na página da fonte que não é do canal oficial** (react, canal do próprio site): não entra. Teste em A8.
5. **Mesma imagem com URLs diferentes em vários sites** (CDNs, tamanhos): conta como repetição. Uma imagem pequena ou muito alta não vira capa. Teste em A3.

---

## Parte 0: escrever pelo Claude Code

> **FEITA em 05/11/2026** (commit 8cb60be, merge na `main` f60e84e; o robô roda assim desde então). Diferenças em relação às tarefas abaixo:
> - entrada e saída `stream-json`, com o schema em draft-07 sem `$schema`;
> - contador por matéria (`claude_usage`, `pnpm gasto`);
> - parada em `CLAUDE_WEEKLY_STOP` = 0.9.
>
> O agendador foi reativado. **Não refazer** as tarefas 0.1 e 0.2.

### Task 0.1: motor `claude-code` atrás da interface `Ai`

**Files:**
- Create: `ROBO NOTICIAS/src/ai/claude-code.ts`
- Modify: `ROBO NOTICIAS/src/ai/client.ts`: exportar `UsageLimitError`
- Modify: `ROBO NOTICIAS/src/config.ts`:
  - `AI_BACKEND`: `"claude-code" | "api"`, padrão `"claude-code"`;
  - `CLAUDE_BIN`: padrão `"claude"`;
  - `CLAUDE_TIMEOUT_MS`: padrão `600000`;
  - `MODEL_VISION`: padrão `"claude-sonnet-5-5"`;
  - `ANTHROPIC_API_KEY` passa a ser obrigatória só quando `AI_BACKEND=api`, via `superRefine`.
- Modify: `ROBO NOTICIAS/src/commands/deps.ts`: `realDeps()` escolhe o motor.
- Modify: `ROBO NOTICIAS/.env.example`
- Test: `ROBO NOTICIAS/test/ai-claude-code.test.ts`, `ROBO NOTICIAS/test/config.test.ts`

**Interfaces:**
- Produces:
  - `type ClaudeRun = (args: string[], stdin: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>`
  - `createClaudeCodeAi(deps: { config: Pick<Config, "CLAUDE_BIN" | "CLAUDE_TIMEOUT_MS">; run?: ClaudeRun; env?: NodeJS.ProcessEnv }): Ai`. O padrão de `run` usa `child_process.spawn(CLAUDE_BIN, args)` e escreve `stdin`.
  - `class UsageLimitError extends BudgetExceededError`, com `readonly resetText: string`. Construtor: `new UsageLimitError(resetText)`, chamando `super("live", 0, 0)` e trocando a `message` para "limite da assinatura do Claude: <resetText>". Como é subclasse, todos os `catch (BudgetExceededError)` de `pipeline.ts` já param a rodada.

- [ ] **Step 1: testes que falham.** Em `test/ai-claude-code.test.ts`, com um `run` falso que grava os argumentos:
  - `"passes system, model, effort and the schema; reads structured_output"`:
    - `args` contém `-p`, `--input-format stream-json`, `--output-format stream-json`, `--verbose`, `--safe-mode`, `--tools ""` (string vazia como item), `--permission-mode dontAsk`, `--no-session-persistence`, `--max-turns 3`, `--model claude-haiku-5-5`, `--effort low` e `--append-system-prompt-file <arquivo>` com o texto do `system`;
    - `--json-schema` é `JSON.stringify(z.toJSONSchema(schema))`;
    - a última linha do stdout falso é `{"type":"result","subtype":"success","is_error":false,"structured_output":{"ok":true}}`, e o retorno é `{ ok: true }` validado pelo schema zod.
  - `"sends images as base64 content blocks before the text"`: o `stdin` é uma linha JSON `{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":…}},{"type":"text","text":"…"}]},"parent_tool_use_id":null}`.
  - `"strips ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN from the child env"`.
  - `"throws UsageLimitError on a subscription limit"`: o texto de saída contém `You've hit your weekly limit · resets Mon 12:00am`, com `is_error: true` e código ≠ 0. Espera `UsageLimitError` com `resetText` `"Mon 12:00am"`.
  - `"throws on schema mismatch"`: `structured_output` ausente ou `subtype` diferente de `success` lança `Error` com "No structured output for <purpose>".
  - `"refusal maps to RefusalError"`: `stop_reason: "refusal"` no resultado.
  - `"batchRequest throws: retroativo desligado"`; `assertBudget` não lança; `recordBatchUsage` não faz nada.
  - Em `config.test.ts`: sem `ANTHROPIC_API_KEY` e com `AI_BACKEND` padrão, `loadConfig` passa; com `AI_BACKEND=api` e sem a chave, falha com "ANTHROPIC_API_KEY is required".
- [ ] **Step 2:** `pnpm test test/ai-claude-code.test.ts test/config.test.ts`. Esperado: FAIL.
- [ ] **Step 3: implementar `createClaudeCodeAi`.**
  - O `system` vai para um arquivo temporário em `os.tmpdir()`, apagado no `finally`.
  - O stdout é lido linha a linha, e a última linha com `type === "result"` é a resposta.
  - O limite da assinatura é detectado com a regex `/hit your (session|weekly|Opus|Sonnet) limit\s*·\s*resets ([^\n"]+)/` sobre stdout+stderr.
  - O `maxTokens` é ignorado.
  - Sem gravar gasto no banco: assinatura não tem custo por chamada.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Esperado: tudo PASS.
- [ ] **Step 5: commit** `feat(robo): write through Claude Code (claude -p) with the API as fallback`.

### Task 0.2: parar limpo no limite e testar ao vivo, com revisão do Lucas

**Files:**
- Modify: `ROBO NOTICIAS/src/pipeline.ts`: `budgetAlert(db, error, now)`, com título e texto próprios quando `error instanceof UsageLimitError`: "Robô parado: limite da assinatura do Claude (volta em <resetText>)".
- Modify: `ROBO NOTICIAS/src/commands/publica.ts`: nova flag `--revisao`, que publica com `status: "review"`, o rascunho no admin do site. Ela entra em `PublicaFlags` e vai até `publishOne` → `createArticle`.
- Create: `ROBO NOTICIAS/test/smoke-claude.test.ts`, que só roda com `CLAUDE_SMOKE=1`: uma chamada real com haiku e um schema de 1 campo.
- Test: `ROBO NOTICIAS/test/pipeline.test.ts`, `ROBO NOTICIAS/test/publica-args.test.ts` (ou o teste existente de `parsePublicaArgs`)

- [ ] **Step 1: testes que falham.**
  - `"a subscription limit during publica puts the story back in the queue and raises the limit alert"`: `ai.structured` falso lança `new UsageLimitError("3:45pm")`. Espera a história em `queued`, um alerta cujo título contém "limite da assinatura" e `reason` contendo "limite da assinatura".
  - `parsePublicaArgs(["--revisao"])` dá `revisao: true`.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3: implementar.** O retorno de `runPublica` (hoje "orçamento diário esgotado") passa a dizer "limite da assinatura (<resetText>)" quando for `UsageLimitError`.
- [ ] **Step 4:** `pnpm test`; depois `CLAUDE_SMOKE=1 pnpm test test/smoke-claude.test.ts`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): stop cleanly on the subscription limit; publica --revisao`.
- [ ] **Step 6: checkpoint com o Lucas.**
  - Fazer o merge do `feat/robo-midia` na `main` (só a Parte 0) e atualizar a cópia que roda: `cd "C:\projetos\Nova pasta" && git merge origin/main`.
  - Em `ROBO NOTICIAS/.env` do PC, conferir que `AI_BACKEND` não está como `api`.
  - Rodar `pnpm coleta`, depois `pnpm publica -- --fora-do-horario --revisao`.
  - Mandar o link do rascunho para o Lucas. Só seguir para a Parte A depois do ok dele sobre o texto. A mídia ainda é a antiga.

---

## Parte A: mídia certa

### Task A1: ler a mídia das páginas das fontes

**Files:**
- Create: `ROBO NOTICIAS/src/collect/media.ts`
- Modify: `ROBO NOTICIAS/src/db.ts`:
  - `items.media_json TEXT` em `ADDED_COLUMNS` e no `itemsTable`;
  - `ItemRow.media_json: string | null`;
  - `setItemMedia(id: number, media: SourceMedia): void`.
- Modify: `ROBO NOTICIAS/src/pipeline.ts`: em `fetchItemTexts`, chamar `extractMedia(text, finalUrl)` sobre o mesmo HTML e gravar com `setItemMedia`, mesmo quando não há texto.
- Test: `ROBO NOTICIAS/test/collect-media.test.ts` (fixtures HTML em `test/fixtures/media/`)

**Interfaces:**
- Produces:
  - `type SourceMedia = { images: { url: string; width?: number; height?: number; role: "og" | "body" }[]; youtube: string[]; posts: { url: string; handle: string; statusId: string }[] }`
  - `extractMedia(html: string, pageUrl: string): SourceMedia`
  - `mediaOf(item: ItemRow): SourceMedia`, com vazio para `null` ou JSON inválido.

- [ ] **Step 1: testes que falham.**
  - `og:image`, `og:image:width` e `og:image:height` viram `role: "og"`, assim como `twitter:image` quando não há `og`.
  - URL relativa é resolvida contra `pageUrl`.
  - `<img>` dentro de `article`/`main` com largura ≥ 600 (atributo ou `srcset` maior) vira `role: "body"`. Ícones, avatares e `data:` ficam de fora. No máximo 10 imagens.
  - YouTube vem de `iframe src` (`youtube.com/embed/ID`, `youtube-nocookie.com/embed/ID`) e de links `watch?v=ID` ou `youtu.be/ID`. Só IDs válidos (`isValidYoutubeId`), sem repetir, no máximo 5.
  - Posts do X vêm de `blockquote.twitter-tweet a[href*="/status/"]` e de links `https://(x|twitter).com/<handle>/status/<id>`. Links `intent`, `share`, `i/web` e `hashtag` ficam de fora. O `handle` sai sem "@", a URL normalizada para `https://x.com/<handle>/status/<id>`, no máximo 5.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3: implementar** com `parseHTML` do linkedom, num documento próprio (o Readability altera o dele).
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): keep the images, YouTube videos and X posts of source pages`.

### Task A2: baixar imagem, medir e tirar a impressão digital

**Files:**
- Create: `ROBO NOTICIAS/src/media/images.ts`
- Test: `ROBO NOTICIAS/test/media-images.test.ts`

**Interfaces:**
- Produces:
  - `type FetchedImage = { url: string; bytes: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; width: number; height: number; hash: bigint }`
  - `fetchImage(url: string, fetchFn: FetchFn): Promise<FetchedImage | null>`: só https, até 8 MiB, `content-type` de imagem, medidas lidas com `sharp().metadata()`.
  - `dHash(bytes: Buffer): Promise<bigint>`: 64 bits, sharp → cinza → 9×8.
  - `hamming(a: bigint, b: bigint): number`
  - `SAME_IMAGE_MAX_DISTANCE = 6`

- [ ] **Step 1: testes que falham.** Imagens geradas com sharp no teste:
  - a mesma imagem em 1200×675 e em 600×338 tem distância ≤ 6;
  - duas imagens diferentes (gradiente × xadrez) têm distância > 20;
  - `fetchImage` devolve `null` para http, para 9 MiB e para `text/html`.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): fetch, measure and fingerprint images`.

### Task A3: candidatas e sinais de imagem oficial

**Files:**
- Create: `ROBO NOTICIAS/src/media/candidates.ts`
- Test: `ROBO NOTICIAS/test/media-candidates.test.ts`

**Interfaces:**
- Consumes: `SourceMedia`/`mediaOf` (A1), `FetchedImage`/`hamming`/`SAME_IMAGE_MAX_DISTANCE` (A2).
- Produces:
  - `type ImageOrigin = "fonte-oficial" | "fonte" | "video-oficial" | "loja" | "catalogo"`
  - `type ImageCandidate = { id: string; url: string; origin: ImageOrigin; sourceName: string; sourceUrl: string; host: string; image?: FetchedImage }`
  - `collectCandidates(input: { items: ItemRow[]; sources: Source[]; officialVideoIds: string[]; catalog: { url: string; gameName: string }[] }): ImageCandidate[]`. A ordem:
    1. imagens das páginas de fontes `tier: "oficial"` → `fonte-oficial`;
    2. capas `https://i.ytimg.com/vi/<id>/maxresdefault.jpg` dos vídeos oficiais → `video-oficial`;
    3. imagens de outras fontes → `fonte`;
    4. URLs em `*.steamstatic.com/store_item_assets` → `loja`;
    5. o catálogo → `catalogo`.

    Sem URL repetida.
  - `markRepeated(cands: ImageCandidate[]): Set<string>`: ids cuja imagem tem gêmea (distância ≤ 6) em **outro host**.
  - `isEligible(c: ImageCandidate, repeated: Set<string>): boolean`: `origin` ≠ `"fonte"`, ou `repeated.has(c.id)`.
  - `fitsCover(img: FetchedImage): boolean`: largura ≥ 1000 e proporção entre 1,3 e 2,4.
  - `fitsBody(img: FetchedImage): boolean`: largura ≥ 600.

- [ ] **Step 1: testes que falham.**
  - A mesma imagem em `cdn.ign.com` e `img.pxngames.com` deixa as duas elegíveis.
  - Uma imagem que só aparece em um site (`fonte`) não é elegível.
  - `fonte-oficial` (Xbox Wire), `video-oficial` e `loja` são elegíveis mesmo sozinhas.
  - 800×800 não serve de capa e 1920×1080 serve. 1200×400 (proporção 3) não serve.
  - Duas cópias da mesma imagem no mesmo host não contam como repetição.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): image candidates and the official-image signals`.

### Task A4: conferência visual (uma chamada por matéria)

**Files:**
- Create: `ROBO NOTICIAS/src/ai/vision.ts`
- Test: `ROBO NOTICIAS/test/ai-vision.test.ts`

**Interfaces:**
- Consumes: `Ai.structured` com `images` (0.1), `ImageCandidate` (A3).
- Produces:
  - `type VisionVerdict = { id: string; ok: boolean; depicts: string; reason: string }`
  - `checkImages(ai: Ai, input: { subject: string; headline: string; candidates: ImageCandidate[] }, opts: { model: string }): Promise<Map<string, VisionVerdict>>`. São no máximo 6 candidatas, com `effort: "low"`, `bucket: "live"` e `purpose: "vision"`. As imagens vão na ordem dos ids, com o texto listando `id → posição`.
  - `VISION_SYSTEM`: texto fixo.
    - **Recusa:** marca d'água ou logo de site de notícias; montagem ou colagem; texto do site sobreposto; print de vídeo de canal não oficial; foto de pessoa sem relação; e assunto diferente de `subject`.
    - **Aceita:** logotipo oficial do jogo, arte de divulgação, capa de trailer oficial, foto oficial de produto e logotipo oficial de empresa.
    - `depicts` descreve o que aparece, por exemplo "logotipo de The Elder Scrolls VI: Sentinel".

- [ ] **Step 1: testes que falham.** Com um `ai` falso:
  - manda as 6 primeiras candidatas que têm `image`, ignora o resto e devolve o mapa por id;
  - id inventado pelo modelo é ignorado;
  - candidata sem resposta fica de fora do mapa e é tratada como recusada.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): one vision check per article for its candidate images`.

### Task A5: escolher, creditar e enviar a imagem; só o jogo exato

**Files:**
- Create: `ROBO NOTICIAS/src/media/choose.ts`
- Modify: `ROBO NOTICIAS/src/tralked.ts`:
  - `uploadImage(bytes: Uint8Array, contentType: string, idempotencyKey: string): Promise<{ url: string }>` (`POST /api/v1/media`, igual a `src/guias/api.ts`);
  - em `ContentBlock`, o tipo `image` ganha `creditUrl?: string`;
  - em `findGame`, sem a reserva `result.games[0]`: só nome ou alias exato, sem diferenciar maiúsculas, ou o nome sem o subtítulo depois de ":".
- Modify: `ROBO NOTICIAS/src/pipeline.ts`: `articleMedia` usa `chooseImages`.
- Modify: `ROBO NOTICIAS/src/assemble.ts`:
  - `ArticleMedia` vira `{ video?; cover?: MediaImage; bodyImage?: MediaImage; trailer? }`, com `MediaImage = { url: string; alt: string; credit: string; creditUrl?: string }`. O campo `posts` entra só na A9;
  - a ordem fica: primeiro parágrafo → `cover` → `video` → resto do corpo, com `bodyImage` depois do 3º bloco do corpo → `trailer` no fim.
  - A capa precisa ser o primeiro bloco `image` da matéria. É ele que o site usa no cartão e no destaque (`toCard` em `app/src/lib/queries/news.ts`).
- Test: `ROBO NOTICIAS/test/media-choose.test.ts`, `test/assemble.test.ts`, `test/tralked.test.ts`, `test/pipeline.test.ts`

**Interfaces:**
- Consumes: A2, A3, A4.
- Produces:
  - `chooseImages(input: { story: StoryRow; items: ItemRow[]; companies: string[]; subject: string; catalog: GameMedia | null; officialVideoIds: string[] }, deps: { ai: Ai; config: Pick<Config, "MODEL_VISION">; fetchFn: FetchFn; tralked: Pick<Tralked, "uploadImage">; log?: (l: string) => void }): Promise<{ cover?: MediaImage; bodyImage?: MediaImage }>`
  - `creditFor(c: ImageCandidate, companies: string[]): { credit: string; creditUrl: string }`. A empresa vem de `companies[0]` da triagem ou, em fonte oficial, do nome da fonte sem o sufixo. O crédito sai:
    - "Divulgação/<Empresa>" para `fonte-oficial`, `video-oficial`, `loja` e `catalogo`;
    - "Divulgação/<Empresa>, via <Veículo>" para `fonte` repetida;
    - "Divulgação, via <Veículo>" sem empresa.

- [ ] **Step 1: testes que falham.**
  - **Sentinel:**
    - fixture com 3 fontes (IGN, PXN, Xbox Wire) trazendo o mesmo logotipo, mais uma capa de vídeo oficial;
    - com a visão aprovando, a `cover` é o logotipo, com o crédito "Divulgação/Bethesda" e o `creditUrl` da fonte oficial;
    - `uploadImage` é chamado uma vez com a chave `noticia-img-<sha40>`.
  - **Itch.io:** só o `og:image` de logo do site, sem repetição, dá `{}` sem `cover`.
  - **Arte do catálogo:** só entra quando `catalog.game` é o jogo da história. O teste de `findGame` cobre isto:
    - "The Elder Scrolls VI" com o retorno `[{ name: "The Elder Scrolls III: Morrowind" }]` dá `null`;
    - "The Elder Scrolls VI: Sentinel" com `[{ name: "The Elder Scrolls VI" }]` dá o jogo.
  - **Visão recusou tudo:** dá `{}`.
  - **`assemble`:**
    - `cover` vem logo depois do primeiro parágrafo e antes do vídeo;
    - `bodyImage` é diferente da `cover`;
    - `creditUrl` só https.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3: implementar.** A capa é a primeira elegível, aprovada e com `fitsCover`. A imagem do corpo é a primeira de `catalogo` aprovada que não seja a capa; sem catálogo, a próxima elegível com `fitsBody`. Uma falha no envio custa só a imagem, nunca a matéria.
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): pick the official image, credit and host it; exact game only`.

### Task A6: site, com crédito clicável, bloco `post` e link no vídeo

**Files:**
- Modify: `app/src/lib/content/schema.ts`:
  - `imageBlockSchema` ganha `creditUrl: z.url({ protocol: /^https$/ }).max(2048).optional()`;
  - novo `postBlockSchema = z.strictObject({ type: z.literal("post"), network: z.literal("x"), url, authorName: plainText(120), authorHandle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/), text: plainText(1000), postedAt: z.iso.datetime().optional() })`, com `url` validada pela regex `^https://x\.com/[A-Za-z0-9_]{1,15}/status/\d{1,25}$`;
  - o novo bloco entra no `contentBlockSchema`.
- Modify: `app/src/lib/content/render.tsx`:
  - o crédito vira link (`rel="noopener noreferrer nofollow"`, `target="_blank"`) quando há `creditUrl`;
  - o vídeo ganha embaixo "Não carregou? [Abrir no YouTube](https://www.youtube.com/watch?v=<id>)";
  - `case "post"` renderiza `<XPostEmbed block={block} />`.
- Create: `app/src/components/content/XPostEmbed.tsx` (client):
  - **Sempre:** um cartão com o texto, o nome, o @, a data e o link "Abrir no X".
  - **Com `useConsent() === "all"`:** carrega `https://platform.twitter.com/widgets.js` uma vez na página e transforma o cartão em `blockquote.twitter-tweet`.
  - **Sem esse consentimento:** mostra o botão "Carregar post", que carrega o script só para aquele post.
  - Embaixo de tudo: "Não carregou? Abrir no X".
- Modify: `app/src/lib/admin/block-draft.ts` e `app/src/components/admin/BlockEditor.tsx`: o bloco `post` aparece no editor só para leitura e é preservado ao salvar.
- Modify: `app/src/app/privacidade/page.tsx`: um parágrafo dizendo que posts do X incorporados só carregam o script do X com "Aceitar todos" ou com um clique em "Carregar post", e que o X pode gravar cookies próprios.
- Test:
  - `app/src/lib/content/schema.test.ts` (ou o arquivo de testes de schema existente);
  - `app/src/components/content/XPostEmbed.test.tsx` (jsdom);
  - o teste de render existente.

- [ ] **Step 1: testes que falham.**
  - **Schema:**
    - aceita `post` válido;
    - recusa `url` `https://evil.com/x/status/1`, `http://x.com/...` e handle com 16 caracteres;
    - `image.creditUrl` http é recusado.
  - **`XPostEmbed`:**
    - com o cookie `tk_consent=necessary`, nenhum `<script src*="platform.twitter.com">` é inserido; aparecem o texto do post, o botão "Carregar post" e o link "Abrir no X" para a `url`;
    - o clique no botão insere o script;
    - com `tk_consent=all`, o script é inserido sem clique.
  - **Render:**
    - o vídeo mostra "Abrir no YouTube" com `watch?v=<id>`;
    - a imagem com `creditUrl` renderiza `<a href=creditUrl>` dentro do `figcaption`.
- [ ] **Step 2:** `cd app && pnpm vitest run <arquivos>`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(news): X post block, clickable image credit, YouTube fallback link`.

### Task A7: site, acervo oficial de consoles e empresas no lugar de "um jogo da empresa"

**Files:**
- Create: `app/public/acervo/*.webp`, imagens oficiais de kits de imprensa, 1600 px de largura, WebP, sem marca d'água.
  - **Consoles:** `ps5`, `ps5-pro`, `xbox-series`, `switch-2`, `steam-deck`.
  - **Empresas:** `playstation`, `xbox`, `nintendo`, `valve-steam`, `ea`, `ubisoft`, `rockstar`, `bethesda`, `capcom`, `square-enix`, `sega`, `bandai-namco`, `epic`, `blizzard`, `activision`, `cd-projekt`, `konami`, `warner-bros-games`, `riot`, `krafton`, `embracer`, `itch-io`.
  - Sem imagem oficial clara, a entrada fica de fora; não se inventa.
- Create: `app/src/lib/news/acervo.ts`: `ACERVO: { key: string; pattern: RegExp; file: string; alt: string; credit: string }[]`, com os consoles antes das empresas (assim "PS5" vence "PlayStation"); `acervoFor(text: string): { url: string; alt: string; credit: string } | null`.
- Modify: `app/src/lib/queries/company-art.ts`: `companyArt` passa a usar `acervoFor(text)` e deixa de sortear um jogo popular da empresa. O cartão recebe a URL como imagem própria (`imageUrl` e `wideImageUrl`, com `art: null`), igual a uma matéria que traz imagem. As funções `COMPANIES` e de galeria que ficarem sem uso são removidas.
- Create: `app/src/lib/news/acervo.test.ts`. Modify: os testes existentes de `company-art`.
- Create (só para o checkpoint, sem commit): `docs/acervo-preview.html`, uma folha de contato com todas as imagens e créditos.

- [ ] **Step 1: testes que falham.**
  - `acervoFor("PS5 chega a 97,9 milhões")` dá ps5; `acervoFor("Sony fala do PS6")` dá playstation; `acervoFor("EA fecha a BioWare")` dá ea; `acervoFor("itch.io terá filtro")` dá itch-io; `acervoFor("Hollow Knight ganha DLC")` dá `null`.
  - Uma matéria sem jogo e sem imagem, com "Bethesda" no título, recebe `/acervo/bethesda.webp` e nunca arte de um jogo.
  - Todo `file` do `ACERVO` existe em `app/public/acervo/`. O teste lê o diretório.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3: juntar as imagens.**
  - Usar só páginas oficiais de imprensa ou de mídia de cada empresa: PlayStation Press, Xbox Wire Media, Nintendo Press, Steam/Valve press, a página de imprensa de cada publisher.
  - Converter com sharp.
  - Anotar a URL de origem de cada uma num comentário em `acervo.ts`.
- [ ] **Step 4:** implementar `acervo.ts` e a mudança em `company-art.ts`. Depois `pnpm test && pnpm typecheck && pnpm lint`. Esperado: PASS.
- [ ] **Step 5: checkpoint com o Lucas.** Mandar a folha de contato e só fazer o commit depois do ok dele. O que ele recusar sai.
- [ ] **Step 6: commit** `feat(news): official console and company images instead of a random company game`.

### Task A8: o vídeo certo

**Files:**
- Create: `ROBO NOTICIAS/src/media/video.ts`
- Modify: `ROBO NOTICIAS/src/pipeline.ts`, em dois pontos:
  - `storyForWriting`: sem vídeo de canal, usa `officialSourceVideo`;
  - `articleMedia`: não põe `trailer` do catálogo quando `aboutVideo(story, items)`.
- Test: `ROBO NOTICIAS/test/media-video.test.ts`, `test/pipeline.test.ts`

**Interfaces:**
- Produces:
  - `officialSourceVideo(input: { items: ItemRow[]; sources: Source[]; games: string[]; companies: string[] }, fetchFn: FetchFn): Promise<{ youtubeId: string; title: string; channel: string } | null>`. Para cada ID de `mediaOf(item).youtube`, no máximo 5, consulta `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json` e lê `title` e `author_name`. O vídeo é aceito quando duas condições valem:
    - **canal oficial:** o `author_name`, normalizado, é igual ao nome de um canal `video: true` de `fontes.json` (sem " (YouTube channel)"), ou contém uma das `companies`;
    - **assunto:** o `title` contém um dos `games` (normalizado, sem subtítulo) ou uma palavra de `/trailer|gameplay|teaser|reveal|announce|anúncio|revelação/i`.
  - `aboutVideo(story: StoryRow, items: ItemRow[]): boolean`: a manchete ou algum título de item casa `/trailer|gameplay|teaser|vídeo|video|reveal/i`, ou a história `isVideoOnly`.

- [ ] **Step 1: testes que falham.**
  - Um vídeo do canal "Bethesda Softworks" com título "The Elder Scrolls VI: Official Name Reveal" é aceito.
  - O canal "IGN" com título "TES 6 trailer reaction" é recusado.
  - Um vídeo oficial sem relação com o jogo é recusado.
  - Uma história de trailer sem vídeo encontrado sai sem `trailer` do catálogo.
  - Uma história comum de DLC mantém o `trailer` no fim, "Vídeo de X".
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar. O vídeo da fonte entra em `StoryForWriting.video` com `only: false`.
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): embed the official video the story is about, never catalog gameplay instead`.

### Task A9: posts do X

**Files:**
- Create: `ROBO NOTICIAS/src/media/xposts.ts`
- Create: `ROBO NOTICIAS/config/perfis-x.json`, perfis oficiais com o handle sem "@" e o nome. Começa com:
  - plataformas: PlayStation, Xbox, NintendoAmerica, Nintendo, NintendoBrasil (se existir), Steam, SteamDeck, valvesoftware;
  - publishers e estúdios: bethesda, RockstarGames, Ubisoft, EA, CapcomUSA_, SquareEnix, SEGA, BandaiNamcoUS, EpicGames, Blizzard_Ent, Activision, CDPROJEKTRED, Konami, wbgames, riotgames, insomniacgames, Naughty_Dog, SuckerPunchProd, FromSoftware_EN, itchio;
  - o builder confere cada handle no X antes.
- Modify: `ROBO NOTICIAS/src/tralked.ts`: o tipo `ContentBlock` ganha `{ type: "post"; network: "x"; url; authorName; authorHandle; text; postedAt? }`.
- Modify: `ROBO NOTICIAS/src/assemble.ts`: posição dos posts (`ArticleMedia.posts`).
- Modify: `ROBO NOTICIAS/src/ai/writer.ts`: seção "## Posts no X" no pedido, no mesmo modelo da de vídeo. Ela diz que cada post aparece incorporado automaticamente e que a IA não deve escrever o link nem copiar o post inteiro.
- Modify: `ROBO NOTICIAS/src/pipeline.ts`: `storyForWriting` e `articleMedia` passam os posts.
- Test: `ROBO NOTICIAS/test/media-xposts.test.ts`, `test/assemble.test.ts`, `test/writer-checker.test.ts`

**Interfaces:**
- Produces:
  - `type XPost = { url: string; authorName: string; authorHandle: string; text: string; postedAt?: string }`
  - `storyPosts(input: { items: ItemRow[]; rumor: boolean; sourceTexts: string[] }, fetchFn: FetchFn, profiles: { handle: string; name: string }[]): Promise<XPost[]>`.
    - **Dados:** via oEmbed (`https://publish.twitter.com/oembed?url=<url>&omit_script=true&dnt=true`): `author_name`, `author_url` e o `html`, de onde saem o texto (`<p>`) e a data (último `<a>`).
    - **Aceita:** handle em `perfis-x.json`; ou `authorName`/`@handle` citado em algum `sourceTexts`; ou qualquer post quando `rumor`.
    - **Limites:** no máximo 2 posts, sem repetir, na ordem em que aparecem nas fontes.
  - Posicionamento em `assemble`: cada post entra depois do primeiro parágrafo do corpo que cita `authorName` ou `@authorHandle`. Se nenhum citar, entra depois do bloco de vídeo, ou da capa, ou do primeiro parágrafo.

- [ ] **Step 1: testes que falham.**
  - `@bethesda`, oficial, é aceito.
  - `@fan123`, citado em lugar nenhum, é recusado em história comum e aceito em rumor.
  - `@jasonschreier`, citado no texto da fonte, é aceito.
  - Falha no oEmbed descarta o post sem quebrar a matéria.
  - Em `assemble`, um post do Todd Howard entra depois do parágrafo que cita "Todd Howard".
  - O texto da IA nunca contém `x.com/` (regra do checker existente, ou uma nova regra em `writer.ts`).
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): embed the official X posts the story is built on`.

### Task A11: galeria em notícia de imagens novas (acréscimo do Lucas, 05/11)

**Files:**
- Create: `ROBO NOTICIAS/src/media/gallery.ts`
- Modify:
  - `ROBO NOTICIAS/src/tralked.ts`: `ContentBlock` ganha `{ type: "gallery"; images: { url; alt; credit; creditUrl? }[] }`;
  - `ROBO NOTICIAS/src/assemble.ts`: `ArticleMedia.gallery?: MediaImage[]`. A galeria entra logo depois do primeiro parágrafo e antes do vídeo, e com ela não entra `bodyImage`;
  - `ROBO NOTICIAS/src/pipeline.ts`: `articleMedia` chama `chooseGallery` quando `isImagesStory`.
- Modify (site):
  - `app/src/lib/content/schema.ts`: `galleryBlockSchema = z.strictObject({ type: z.literal("gallery"), images: z.array(z.strictObject({ url: <https como image>, alt: plainText(300), credit: plainText(200), creditUrl: <https opcional> })).min(3).max(12) })`, incluído no `contentBlockSchema`;
  - `app/src/lib/content/render.tsx`: `case "gallery"` → `<Gallery block={block} />`;
  - `app/src/lib/admin/block-draft.ts` e `app/src/components/admin/BlockEditor.tsx`: a galeria aparece só para leitura e é preservada ao salvar.
- Create (site): `app/src/components/content/Gallery.tsx`, componente client. A grade usa 2 colunas abaixo de 640 px e 3 a partir daí.
  - O clique abre um `<dialog>` com a imagem grande.
  - No diálogo, Esc fecha, ←/→ navegam, o foco fica preso e volta à miniatura ao fechar.
  - Com o mesmo crédito em todas as imagens, ele vira uma legenda única da galeria. Com créditos diferentes, cada imagem leva o seu.
- Test: `ROBO NOTICIAS/test/media-gallery.test.ts`, `ROBO NOTICIAS/test/assemble.test.ts`, `app/src/components/content/Gallery.test.tsx` e o teste de schema.

**Interfaces:**
- Consumes: A2 (`fetchImage`, `hamming`, `SAME_IMAGE_MAX_DISTANCE`), A3 (`collectCandidates`, `markRepeated`, `isEligible`, `fitsBody`), A4 (`checkImages`) e A5 (`creditFor`, `uploadImage`, `MediaImage`).
- Produces:
  - `isImagesStory(story: StoryRow, items: ItemRow[]): boolean`. É verdadeiro quando a manchete ou algum título de item casa com `/novas imagens|screenshots?|galeria|capturas|fotos oficiais|imagens oficiais|key art|new images|gallery/i`.
  - `chooseGallery(input: { candidates: ImageCandidate[]; cover?: MediaImage; subject: string; headline: string; companies: string[] }, deps: …mesmos de chooseImages): Promise<MediaImage[]>`:
    - fica com as candidatas elegíveis e com `fitsBody`, sem a capa nem quase-duplicatas;
    - a visão roda em no máximo 2 chamadas de 6;
    - envia até 8 imagens;
    - devolve `[]` com menos de 3 aprovadas.
  - `GALLERY_MIN = 3`, `GALLERY_MAX = 8`.

- [ ] **Step 1: testes que falham.**
  - **Robô:**
    - uma história "Rockstar solta novas imagens de GTA 6" com 5 imagens oficiais repetidas em 2 hosts gera um bloco `gallery` com 5 imagens e crédito "Divulgação/Rockstar Games";
    - com só 2 aprovadas, não há galeria;
    - uma imagem recusada pela visão fica fora;
    - quase-duplicatas (mesma imagem em dois tamanhos) contam uma vez;
    - `isImagesStory` é falso para "GTA 6 é adiado".
  - **Site:**
    - o schema recusa galeria com 2 imagens ou com URL http;
    - o `Gallery` abre o diálogo ao clicar, Esc fecha, → vai para a próxima e o foco volta à miniatura.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** robô `pnpm test && pnpm typecheck`; site `pnpm test && pnpm typecheck && pnpm lint`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo,news): news about new images brings the official gallery`.

### Task A12: fontes sem repetição e comando de conferência

**Files:**
- Modify: `ROBO NOTICIAS/src/assemble.ts`: `sourceBlocks` cita cada veículo uma vez. A chave é o nome normalizado, e fica a URL da fonte mais bem colocada (`writerSources` já ordena).
- Create: `ROBO NOTICIAS/src/commands/midia.ts` e o script `"midia": "tsx src/commands/midia.ts"` no `package.json`. `pnpm midia -- --historia <id> [--historia <id>…]` roda a escolha de mídia sem publicar e sem enviar imagem (com `uploadImage` falso) e imprime:
  - as candidatas, a origem e se são repetidas;
  - o veredito da visão;
  - a capa e a imagem do corpo escolhidas, com o crédito;
  - o vídeo e os posts.
- Test: `ROBO NOTICIAS/test/assemble.test.ts`

- [ ] **Step 1: teste que falha.** 7 fontes "Steam News" com URLs diferentes e 1 do "Xbox Wire" geram exatamente 2 itens em "Fontes".
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: commit** `fix(robo): one entry per outlet in Fontes; pnpm midia dry run`.
- [ ] **Step 6: checkpoint e entrega (a).**
  1. Rodar `pnpm midia` nas histórias 4929 (Sentinel), 4838 (Xbox Wire), 4790 (BioWare), 4840 (itch.io) e 5265 (galeria do GTA 6) e mandar o resultado ao Lucas.
  2. Passar a ele o comando de produção que dá `media:write` à chave do robô de notícias. Antes, o builder confere em `app/src/lib/api/` como os escopos são guardados e monta o `UPDATE` exato.
  3. Depois do ok dele: merge `--no-ff` na `main`, push, esperar o deploy da Vercel com sucesso e atualizar a cópia que roda (`git merge origin/main` em `C:\projetos\Nova pasta`).

---

## Parte B: variedade e qualidade

### Task B1: a triagem dá tipo, plataforma e item recorrente; promoções relevantes passam

**Files:**
- Modify: `ROBO NOTICIAS/src/ai/triage.ts`:
  - `TOPICS = ["anuncio","trailer","lancamento","atualizacao","vendas","hardware","negocios","assinaturas-gratis","promocao-loja","notas-imprensa","adaptacao","mobile","indie","rumor","declaracao","comunidade"] as const`;
  - `PLATFORMS = ["steam-pc","playstation","xbox","nintendo","mobile","multi"] as const`;
  - `RECURRING = ["ps-plus","game-pass","epic-gratis"] as const`;
  - `Triage` ganha `topic: Topic`, `platforms: Platform[]` e `recurring: Recurring | null`.
- Modify: `TRIAGE_SYSTEM`.
  - **Continua `keep:false`:** cupons e códigos; posts de afiliado ou patrocinados; descontos pequenos de um jogo só; listas e rankings; opinião e editorial ("questionando", "melhores X"); qualquer coisa fora de games (música, esporte, animes e filmes que não vêm de jogos); itens cujo único fato é "X publicou um post ou artigo sobre Y".
  - **Passa a valer `keep:true`:** PS Plus do mês; novidades do Game Pass; jogo grátis da Epic; eventos da Steam (promoções sazonais, Next Fest, fins de semana grátis); jogo que ficou grátis; mudança de preço de console; recordes de jogadores; notas que a imprensa está dando a um lançamento grande.
  - **Pontuação:** a explicação ganha uma linha: notícia de Steam ou PC e da Nintendo interessa muito ao público do Tralked.
- Modify: `ROBO NOTICIAS/src/db.ts`: `stories.topic TEXT`, `stories.platforms_json TEXT NOT NULL DEFAULT '[]'` e `stories.recurring_key TEXT` em `ADDED_COLUMNS`, com os campos em `StoryRow` e `upsertStory`.
- Modify: `ROBO NOTICIAS/src/pipeline.ts`: `storyFacts` e `recomputeStory`.
  - `topic` vem do item de maior importância.
  - `platforms` é a união das plataformas dos itens.
  - `recurring_key` = `recurringKey(recurring, storyDate)`.
- Create: `ROBO NOTICIAS/src/recurring.ts`, com `recurringKey(kind: Recurring, day: Date): string`:
  - `ps-plus:YYYY-MM`;
  - `game-pass:YYYY-MM-a` até o dia 15 e `-b` depois;
  - `epic-gratis:YYYY-Www` (semana ISO, em horário de São Paulo).
- Test: `ROBO NOTICIAS/test/triage-cluster.test.ts`, `test/recurring.test.ts`, `test/pipeline.test.ts`

- [ ] **Step 1: testes que falham.**
  - **Schema da triagem:** aceita os campos novos; `topic` desconhecido falha no zod.
  - **`recurringKey`:**
    - `("ps-plus", 2026-11-05)` dá `ps-plus:2026-11`;
    - `("game-pass", 2026-11-20)` dá `game-pass:2026-11-b`;
    - `("epic-gratis", 2026-11-05)` dá `epic-gratis:2026-W45`.
  - **`storyFacts`:** o `topic` vem do item mais importante, e `platforms` é a união sem repetição.
  - **Item recorrente:** uma história com `recurring_key` igual ao de uma matéria já publicada vira `dropped` em `queueStories`.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm test && pnpm typecheck`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): triage topic, platforms and recurring items; relevant deals and free games pass`.

### Task B2: escolha do horário por mistura

**Files:**
- Create: `ROBO NOTICIAS/src/mix.ts`
- Modify: `ROBO NOTICIAS/src/pipeline.ts`: `nextQueued` escolhe pela maior `mixScore`, não pela ordem de pontuação. As bombas continuam fora da mistura.
- Modify: `ROBO NOTICIAS/src/db.ts`: `publishedTodayMix(day: string): { topics: Record<string, number>; platforms: Record<string, number> }`, com as matérias `live` publicadas no dia local.
- Test: `ROBO NOTICIAS/test/mix.test.ts`, `test/pipeline.test.ts`

**Interfaces:**
- Produces:
  - `MIX = { steamPcBonus: 6, nintendoBonus: 15, nintendoMinScore: 50, topicCap: 3, platformCap: 6, overCapPenalty: 25 } as const`
  - `mixScore(story: { score: number; topic: string | null; platforms: string[] }, today: { topics: Record<string, number>; platforms: Record<string, number> }): number`. A conta:
    - parte de `score`;
    - soma `+ steamPcBonus` quando há `steam-pc`;
    - soma `+ nintendoBonus` quando há `nintendo`, `today.platforms.nintendo` é 0 e `score >= nintendoMinScore`;
    - tira `− overCapPenalty` quando `today.topics[topic] >= topicCap`;
    - tira `− overCapPenalty` para cada plataforma da história com `today.platforms[p] >= platformCap`, exceto `multi`.

- [ ] **Step 1: testes que falham.**
  - **Bônus Steam/PC:** duas histórias com score 70, uma `steam-pc` e outra `playstation`, sem nada publicado no dia: ganha a de Steam.
  - **Teto de tipo:** com 3 `lancamento` já no dia, uma de `lancamento` com 80 perde para uma de `vendas` com 60.
  - **Nintendo:** uma `nintendo` com 55 ganha de uma `xbox` com 65 quando a Nintendo ainda não saiu no dia, e perde quando já saiu.
  - **Bombas:** passam na frente de tudo, sem mudança.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `feat(robo): daily mix of topics and platforms (slight Steam/PC lead, Nintendo guaranteed)`.

### Task B3: sem a mesma notícia no mesmo dia

**Files:**
- Modify: `ROBO NOTICIAS/src/pipeline.ts`: `coveredStories` também compara histórias **sem jogos** com o feed do site. Usa `clusterItems` com os títulos do feed como histórias abertas quando a história e a matéria têm alguma empresa em comum. Hoje só compara quando há slug de jogo em comum.
- Test: `ROBO NOTICIAS/test/pipeline.test.ts`

- [ ] **Step 1: teste que falha.** Com o feed tendo "itch.io terá filtro sem IA na busca de jogos" (companies `itch.io`), uma história nova "itch.io leva filtro de IA generativa para a busca" que o cluster falso marca como a mesma vira `dropped` e `report.covered++`.
- [ ] **Step 2:** rodar. Esperado: FAIL.
- [ ] **Step 3:** implementar. Para isso, as empresas da matéria publicada passam a ficar gravadas: `articles.companies_json` em `ADDED_COLUMNS`, preenchido ao publicar a partir da triagem.
- [ ] **Step 4:** `pnpm test`. Esperado: PASS.
- [ ] **Step 5: commit** `fix(robo): a story the site already covered today is dropped even without a game`.

### Task B4: fontes para Steam, Nintendo e mobile

**Files:**
- Modify: `ROBO NOTICIAS/config/fontes.json`
- Test: `ROBO NOTICIAS/test/config.test.ts` (o arquivo real continua válido)

- [ ] **Step 1: verificar ao vivo cada candidata.** O feed precisa responder 200, ser RSS ou Atom válido e ter itens recentes. Candidatas:
  - **Steam:** blog oficial da Steam, `https://store.steampowered.com/feeds/news/collection/steam/` (`oficial`, `GAMES`), e o feed da Steam Deck, se existir.
  - **Nintendo:** Nintendo Life (`portal`) e Nintendo of Europe news (`oficial`), se tiver feed.
  - **Mobile:** Pocket Gamer (`portal`, `gamingFilter: true`).
  - **PC:** IGN PC ou PCGamesN (`portal`).

  Fica só o que responder.
- [ ] **Step 2:** acrescentar as que passaram, com `active: true`. Depois `pnpm test`. Esperado: PASS, com `loadSources()` aceitando o arquivo.
- [ ] **Step 3: commit** `feat(robo): sources for Steam events, Nintendo and mobile`.
- [ ] **Step 4: entrega (b).**
  - Merge `--no-ff` na `main`, push e atualizar a cópia que roda.
  - Depois de 2 dias rodando, mandar ao Lucas a contagem por tipo e por plataforma das matérias publicadas (`publishedTodayMix` por dia).

---

## Fora deste plano

- A revisão das Pautas (item 19) e a revisão final do robô vêm depois desta entrega.
- O robô de guias continua na API.
- Matérias de recorde com os dados de jogadores do próprio site: opção não obrigatória da spec, deixada para depois.
