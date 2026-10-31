import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_SESSION_SECRET } from "./config";
import { loginAs, sql, userId } from "./helpers";

/*
 * End-to-end flows of the Review Focus (global constraints): the bot API with a key created in
 * /admin/robos and an editor publishing what it sent, community writes (comment, like, forum
 * reply, "Resolveu", refused uploads), fraud lowering a level,
 * non-staff locked out of /admin and its Server Actions, and the newsletter double opt-in.
 *
 * Sessions are signed with the e2e server's secret (loginAs), so these run against the
 * production build too. Every run uses fresh names, so the suite can run again on the same DB.
 */

const run = Date.now().toString(36);

/** Creates a bot key in /admin/robos as the admin and returns its secret (shown once). */
async function createBotKey(page: Page, name: string): Promise<string> {
  await loginAs(page, "lucas");
  await page.goto("/admin/robos");
  await page.getByLabel("Nome do robô").fill(name);
  await page.getByRole("button", { name: "Criar chave" }).click();
  const secret = page.getByLabel("Chave secreta");
  await expect(secret).toHaveValue(/^tk_live_/);
  return secret.inputValue();
}

function botPost(request: APIRequestContext, secret: string, body: unknown, idem: string | null, raw?: string) {
  return request.post("/api/v1/articles", {
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...(idem ? { "idempotency-key": idem } : {}),
    },
    // A Buffer goes as-is (Playwright would JSON-encode a string sent as application/json).
    data: Buffer.from(raw ?? JSON.stringify(body)),
  });
}

/** The level for a total XP (Tibia curve, as src/lib/engine/xp.ts). */
function levelFor(totalXp: number): number {
  const expFor = (l: number) => Math.round((50 / 3) * (l ** 3 - 6 * l ** 2 + 17 * l - 12));
  let level = 1;
  while (expFor(level + 1) <= totalXp) level++;
  return level;
}

type ApiError = { error: { code: string; message: string; issues: { path: string; message: string }[] } };

test.describe("bot API → review → publish", () => {
  test("a robot sends an article with a key from /admin/robos and an editor publishes it", async ({ page }) => {
    const botName = `e2e robô ${run}`;
    const secret = await createBotKey(page, botName);
    const request = page.request;
    const title = `Robô do e2e publica nota ${run}`;
    const article = {
      title,
      category: "GAMES",
      games: [{ slug: "hollow-knight" }],
      blocks: [{ type: "paragraph", text: "Nota **curta** enviada pelo robô do teste." }],
    };

    // Malformed requests: clear 4xx with the path of the field, and nothing is stored.
    const noKey = await botPost(request, secret, article, null);
    expect(noKey.status()).toBe(400);
    expect(((await noKey.json()) as ApiError).error.code).toBe("idempotency_key_required");

    const badJson = await botPost(request, secret, null, `bad-json-${run}`, "{ title: ");
    expect(badJson.status()).toBe(400);
    expect(((await badJson.json()) as ApiError).error.code).toBe("invalid_json");

    const hostile = await botPost(
      request,
      secret,
      {
        ...article,
        blocks: [
          { type: "paragraph", text: "<script>alert(1)</script>" },
          { type: "image", url: "http://exemplo.com/a.jpg", alt: "Imagem sem https" },
          { type: "paragraph", text: "[clique](javascript:alert(1))" },
        ],
      },
      `hostile-${run}`,
    );
    expect(hostile.status()).toBe(422);
    const hostilePaths = ((await hostile.json()) as ApiError).error.issues.map((i) => i.path);
    expect(hostilePaths).toEqual(expect.arrayContaining(["/blocks/0/text", "/blocks/1/url", "/blocks/2/text"]));

    const unknownGame = await botPost(request, secret, { ...article, games: [{ slug: "jogo-que-nao-existe" }] }, `game-${run}`);
    expect(unknownGame.status()).toBe(422);
    expect(((await unknownGame.json()) as ApiError).error.issues[0]?.path).toBe("/games/0");

    const unauthorized = await botPost(request, "tk_live_nao-existe", article, `nokey-${run}`);
    expect(unauthorized.status()).toBe(401);

    // The real request, then a replay: same answer, one article.
    const idem = `e2e-article-${run}`;
    const created = await botPost(request, secret, article, idem);
    expect(created.status()).toBe(201);
    const first = (await created.json()) as { id: string; status: string; url: string };
    expect(first.status).toBe("review");
    const replay = await botPost(request, secret, article, idem);
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(first);
    const conflict = await botPost(request, secret, { ...article, title: `${title} (outro)` }, idem);
    expect(conflict.status()).toBe(409);
    const [{ count }] = await sql<{ count: string }>(`select count(*) from "Article" where title = $1`, [title]);
    expect(Number(count)).toBe(1);

    // Not public before review.
    const slug = new URL(first.url).pathname.split("/").pop() ?? "";
    expect((await page.goto(`/noticias/${slug}`))?.status()).toBe(404);

    // An editor publishes it from the review queue.
    await page.goto("/admin/revisao");
    await page.getByRole("button", { name: `Publicar "${title}"` }).click();
    await expect(page.getByRole("button", { name: `Publicar "${title}"` })).toHaveCount(0);

    const published = await page.goto(`/noticias/${slug}`);
    expect(published?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText(`Robô ${botName}`)).toBeVisible();
    await expect(page.getByText("Gerado por robô · revisado pela redação")).toBeVisible();
  });
});

test.describe("community", () => {
  test("comment on a photo: empty and HTML refused, plain text published; like toggles", async ({ page }) => {
    await loginAs(page, "Cacador_Joaquim");
    await page.goto("/galeria/seed-photo-03");
    const box = page.getByRole("textbox", { name: "Escreva um comentário" });
    const send = page.getByRole("button", { name: "Comentar" });

    await send.click();
    await expect(page.locator("#comentarios").getByRole("alert")).toContainText("Escreva alguma coisa antes de enviar.");

    await box.fill("<b>negrito</b> escondido");
    await send.click();
    await expect(page.locator("#comentarios").getByRole("alert")).toContainText("HTML não é permitido");

    const text = `Que captura! (${run})`;
    await box.fill(text);
    await send.click();
    await expect(page.locator("#comentarios").getByText(text)).toBeVisible();
    await expect(box).toHaveValue("");

    const like = page.getByRole("button", { name: /^Curtir/ });
    const pressed = (await like.getAttribute("aria-pressed")) === "true";
    const before = Number((await like.textContent())?.match(/\d+/)?.[0]);
    // The button flips at once (optimistic); wait for the Server Action itself before reloading,
    // or a slow dev server can still be handling it when the reload aborts the request.
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]));
    await like.click();
    await saved;
    await expect(like).toHaveAttribute("aria-pressed", String(!pressed));
    await expect(like).toContainText(String(before + (pressed ? -1 : 1)));
    // The like is stored: it survives a reload.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Curtir/ })).toHaveAttribute("aria-pressed", String(!pressed));
  });

  test("forum: a player opens a thread, another replies, the author marks it as solved", async ({ page }) => {
    const title = `Como passo do chefe final? ${run}`;
    await loginAs(page, "Guardia_Selene");
    await page.goto("/forum/ajuda");
    await page.getByRole("button", { name: "Novo tópico" }).click();
    await page.getByLabel("Título").fill(title);
    await page.getByLabel("Mensagem").fill("Já tentei de tudo e não passo da segunda fase.");
    await page.getByRole("button", { name: "Publicar tópico" }).click();
    await expect(page).toHaveURL(/\/forum\/t\/[a-z0-9]+/);
    const threadUrl = page.url();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await loginAs(page, "Herbalista_Rosa");
    await page.goto(threadUrl);
    const reply = `Use o amuleto da carapaça e fique à esquerda. (${run})`;
    await page.getByRole("textbox", { name: "Sua resposta" }).fill(reply);
    await page.getByRole("button", { name: "Responder" }).click();
    await expect(page.getByRole("article", { name: "Resposta de @Herbalista_Rosa" })).toContainText(reply);
    // Only the thread author can mark a reply.
    await expect(page.getByRole("button", { name: "Esta resolveu" })).toHaveCount(0);

    await loginAs(page, "Guardia_Selene");
    await page.goto(threadUrl);
    await page.getByRole("button", { name: "Esta resolveu" }).click();
    await expect(page.getByText("Resolvido pela resposta de")).toBeVisible();
    await expect(page.getByRole("article", { name: /Resposta de @Herbalista_Rosa, marcada como a que resolveu/ })).toBeVisible();
  });

  test("photo upload: a fake image is refused, and visitors cannot upload", async ({ page, playwright, baseURL }) => {
    await loginAs(page, "Cacador_Joaquim");
    const fake = await page.request.post("/galeria/enviar", {
      multipart: {
        foto: { name: "captura.png", mimeType: "image/png", buffer: Buffer.from("isto não é uma imagem, é texto") },
        jogo: "hollow-knight",
        legenda: "Falsa",
      },
    });
    expect(fake.status()).toBe(422);
    expect(await fake.json()).toMatchObject({ status: "invalid", field: "foto" });

    const visitor = await playwright.request.newContext({ baseURL });
    const anonymous = await visitor.post("/galeria/enviar", {
      multipart: { foto: { name: "a.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50]) }, jogo: "hollow-knight" },
    });
    expect(anonymous.status()).toBe(401);
    await visitor.dispose();

    const cross = await page.request.post("/galeria/enviar", {
      headers: { origin: "https://site-malicioso.example" },
      multipart: { foto: { name: "a.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50]) }, jogo: "hollow-knight" },
    });
    expect(cross.status()).toBe(403);
  });
});

test.describe("admin decisions and access", () => {
  test("confirming fraud voids the XP already paid and lowers the level", async ({ page }) => {
    const id = await userId("lucas");
    // The game where lucas has the most XP still counted (each run takes the next one).
    const [target] = await sql<{ gameId: string; xp: string }>(
      `select a."gameId", sum(l.xp) as xp
         from "XpLedgerEntry" l join "Achievement" a on a.id = l."sourceKey"
        where l."userId" = $1 and l.source = 'achievement' and l."voidedAt" is null and a.platform = 'steam'
        group by a."gameId" order by 2 desc limit 1`,
      [id],
    );
    test.skip(!target, "no paid Steam unlocks left for lucas: reseed the e2e database");
    const [{ name }] = await sql<{ name: string }>(`select name from "Game" where id = $1`, [target.gameId]);
    // The anti-fraud rules flag the unlocks (as a sync would).
    await sql(
      `update "UserAchievement" ua set suspicious = true, "fraudReview" = null
         from "Achievement" a where a.id = ua."achievementId" and ua."userId" = $1 and a."gameId" = $2 and a.platform = 'steam'`,
      [id, target.gameId],
    );
    const stats = async () => {
      const [row] = await sql<{ level: number; totalXp: string }>(
        `select level, "totalXp" from "UserStats" where "userId" = $1`,
        [id],
      );
      return { after: Number(row.level), total: Number(row.totalXp) };
    };
    const { after: before, total: totalBefore } = await stats();

    await loginAs(page, "lucas");
    await page.goto("/admin/fraude");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: new RegExp(`^Confirmar fraude: .* de @lucas em ${name}$`) }).click();
    await expect(page.getByRole("button", { name: new RegExp(`de @lucas em ${name}$`) })).toHaveCount(0);

    // Every unlock of the case is voided, the total drops by at least what was paid for them, and
    // the level follows the total (it drops whenever the total falls under the level's threshold).
    const { total, after } = await stats();
    expect(total).toBeLessThanOrEqual(totalBefore - Number(target.xp));
    expect(after).toBe(levelFor(total));
    if (levelFor(totalBefore - Number(target.xp)) < before) expect(after).toBeLessThan(before);
    const [{ open }] = await sql<{ open: string }>(
      `select count(*) as open from "XpLedgerEntry" l join "Achievement" a on a.id = l."sourceKey"
        where l."userId" = $1 and l.source = 'achievement' and l."voidedAt" is null and a."gameId" = $2`,
      [id, target.gameId],
    );
    expect(Number(open)).toBe(0);
  });

  test("players and authors get a real 404 on /admin; an editor is kept out of admin-only pages", async ({ page }) => {
    for (const handle of ["Cacador_Joaquim", "Escriba_Odete"]) {
      await loginAs(page, handle);
      for (const path of ["/admin", "/admin/revisao", "/admin/robos"]) {
        expect((await page.goto(path))?.status(), `${handle} ${path}`).toBe(404);
      }
    }
    await loginAs(page, "Cronista_Iolanda");
    expect((await page.goto("/admin/revisao"))?.status()).toBe(200);
    expect((await page.goto("/admin/robos"))?.status()).toBe(404);
  });

  test("admin Server Actions refuse a non-admin session, even when replayed outside /admin", async ({ page }) => {
    const name = `e2e chave ${run}`;
    await loginAs(page, "lucas");
    await page.goto("/admin/robos");
    await page.getByLabel("Nome do robô").fill(name);
    // Record the real Server Action request the admin's click sends.
    const actionRequest = page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"]));
    await page.getByRole("button", { name: "Criar chave" }).click();
    const recorded = await actionRequest;
    await expect(page.getByLabel("Chave secreta")).toHaveValue(/^tk_live_/);
    const count = async () => (await sql(`select id from "ApiKey" where name = $1`, [name])).length;
    expect(await count()).toBe(1);

    const resend = (path: string) =>
      page.request.post(path, {
        headers: {
          "next-action": recorded.headers()["next-action"],
          "content-type": recorded.headers()["content-type"] ?? "text/plain;charset=UTF-8",
          accept: "text/x-component",
        },
        data: Buffer.from(recorded.postData() ?? ""),
      });

    // A player or an editor sends it again: on /admin/robos the proxy refuses it before any action
    // runs, on a page the admin may open (editor) or any other page Next does not route the action.
    // (The action's own role check behind both is covered in src/app/admin/actions.test.ts.)
    for (const [handle, paths] of [
      ["Cacador_Joaquim", ["/admin/robos", "/"]],
      ["Cronista_Iolanda", ["/admin/robos", "/admin/revisao", "/"]],
    ] as const) {
      await loginAs(page, handle);
      for (const path of paths) {
        const response = await resend(path);
        expect(response.ok(), `${handle} ${path}`).toBe(false);
        expect(await response.text()).not.toContain("tk_live_");
      }
    }
    expect(await count()).toBe(1);
  });
});

test.describe("newsletter (double opt-in)", () => {
  test("signing up stores an unconfirmed address; only the signed link + button confirms it", async ({ page }) => {
    const email = `e2e-${run}@exemplo.com`;
    await page.goto("/jogos");
    const form = page.getByRole("region", { name: /principais notícias e guias da semana/ });
    await form.getByRole("textbox", { name: "Seu e-mail" }).fill(email);
    await form.getByRole("button", { name: /INSCREVER/ }).click();
    await expect(form.getByRole("status")).toContainText(email);
    const stored = async () =>
      (await sql<{ confirmedAt: Date | null }>(`select "confirmedAt" from "NewsletterSubscriber" where email = $1`, [email]))[0];
    expect((await stored()).confirmedAt).toBeNull();

    // A forged token is refused and confirms nothing.
    await page.goto(`/newsletter/confirmar?email=${encodeURIComponent(email)}&token=9999999999.${"A".repeat(43)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Link inválido");

    // The link the e-mail carries (same HMAC as the server): opening it changes nothing yet.
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 86_400;
    const signature = createHmac("sha256", E2E_SESSION_SECRET).update(`newsletter:${email}:${expiresAt}`).digest("base64url");
    await page.goto(`/newsletter/confirmar?email=${encodeURIComponent(email)}&token=${expiresAt}.${signature}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirmar inscrição");
    expect((await stored()).confirmedAt).toBeNull();

    await page.getByRole("button", { name: "Confirmar inscrição" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inscrição confirmada");
    expect((await stored()).confirmedAt).not.toBeNull();
  });
});
