import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginAs, sql, userId } from "./helpers";

// Social (Plano 4, F9): follow + friendship, private messages, comment reactions/replies/"Útil",
// collapsed comments and the feed. Works in both modes (sessions are signed cookies). The seeded
// users below have no seeded social data; each run resets what the previous one left.

const run = Date.now().toString(36);
const BLOCKING = ["serious", "critical"];

async function expectNoBlockingAxe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => BLOCKING.includes(v.impact ?? "")).map((v) => ({ id: v.id, nodes: v.nodes.length }));
  expect(blocking, JSON.stringify(blocking)).toEqual([]);
}

async function resetBetween(handles: string[]) {
  const ids = await Promise.all(handles.map(userId));
  await sql(`delete from "Follow" where "followerId" = any($1) and "followeeId" = any($1)`, [ids]);
  await sql(`delete from "Friendship" where "userLowId" = any($1) and "userHighId" = any($1)`, [ids]);
  await sql(`delete from "UserBlock" where "blockerId" = any($1) and "blockedId" = any($1)`, [ids]);
  await sql(`delete from "Conversation" where "userLowId" = any($1) and "userHighId" = any($1)`, [ids]);
  await sql(`update "User" set "dmPolicy" = 'everyone' where id = any($1)`, [ids]);
  return ids;
}

test.describe("social", () => {
  test("follow, friend request and accept: both follow each other", async ({ page }) => {
    await resetBetween(["Ferreiro_Bastiao", "Lenhador_Bento"]);
    await loginAs(page, "Ferreiro_Bastiao");
    await page.goto("/jogador/Lenhador_Bento");
    await page.getByRole("button", { name: "Seguir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Seguindo" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Adicionar amigo" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Pedido enviado" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pedido enviado/ })).toBeVisible();
    await expectNoBlockingAxe(page);

    await loginAs(page, "Lenhador_Bento");
    await page.goto("/jogador/Lenhador_Bento/amigos");
    const requests = page.getByRole("region", { name: "Pedidos de amizade" });
    await requests.getByRole("button", { name: "Aceitar @Ferreiro_Bastiao" }).click();
    // The page refreshes: the request leaves the list and the friend shows up under Amigos.
    await expect(requests).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Amigos" }).getByRole("link", { name: "@Ferreiro_Bastiao" })).toBeVisible();
    await page.goto("/jogador/Lenhador_Bento/amigos?lista=seguindo");
    await expect(page.getByRole("list", { name: "Seguindo" }).getByRole("link", { name: "@Ferreiro_Bastiao" })).toBeVisible();
    await expectNoBlockingAxe(page);
  });

  test("private message: HTML refused, text with a safe link delivered, unread badge, DM setting and block", async ({ page }) => {
    await resetBetween(["Mercador_Anselmo", "Lenhador_Bento"]);
    await loginAs(page, "Mercador_Anselmo");
    await page.goto("/mensagens/Lenhador_Bento");
    const box = page.getByRole("textbox", { name: "Mensagem para @Lenhador_Bento" });
    await box.fill("<b>oi</b>");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("HTML não é permitido")).toBeVisible();
    const text = `Oi Bento! Olha https://tralked.com/jogos (${run})`;
    await box.fill(text);
    await page.getByRole("button", { name: "Enviar" }).click();
    const sent = page.getByRole("list", { name: "Mensagens com @Lenhador_Bento" });
    await expect(sent).toContainText(`(${run})`);
    await expect(sent.getByRole("link", { name: "https://tralked.com/jogos" }).last()).toHaveAttribute("rel", /nofollow/);

    await loginAs(page, "Lenhador_Bento");
    await page.goto("/");
    await expect(page.getByRole("link", { name: /^Mensagens, 1 conversa não lida/ })).toBeVisible();
    await page.goto("/mensagens");
    await page.getByRole("link", { name: /Mercador/ }).first().click();
    await expect(page.getByRole("list", { name: "Mensagens com @Mercador_Anselmo" })).toContainText(`(${run})`);
    await expectNoBlockingAxe(page);
    await page.goto("/mensagens");
    await expect(page.getByRole("link", { name: /^Mensagens$/ })).toBeVisible();

    // "Só amigos" in /conta: the other one can no longer write.
    await page.goto("/conta#mensagens");
    await page.getByRole("radio", { name: /Só amigos/ }).check();
    await expect(page.getByRole("status").filter({ hasText: "Salvo." })).toBeVisible();
    await loginAs(page, "Mercador_Anselmo");
    await page.goto("/mensagens/Lenhador_Bento");
    await expect(page.getByText("Essa pessoa só recebe mensagens de amigos.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Mensagem para @Lenhador_Bento" })).toHaveCount(0);

    // Blocking from the conversation: nobody writes to the other.
    await sql(`update "User" set "dmPolicy" = 'everyone' where handle = 'Lenhador_Bento'`);
    await loginAs(page, "Lenhador_Bento");
    await page.goto("/mensagens/Mercador_Anselmo");
    await page.getByRole("button", { name: "Bloquear @Mercador_Anselmo" }).click();
    await page.getByRole("button", { name: "Sim, bloquear" }).click();
    await expect(page.getByText("Você bloqueou @Mercador_Anselmo.")).toBeVisible();
    await loginAs(page, "Mercador_Anselmo");
    await page.goto("/mensagens/Lenhador_Bento");
    await expect(page.getByText("Não é possível trocar mensagens com essa pessoa.")).toBeVisible();
  });

  test("comments: like, threaded reply and the parent's author marks it helpful", async ({ page }) => {
    await resetBetween(["Mercador_Anselmo", "Escudeiro_Tadeu"]);
    await loginAs(page, "Mercador_Anselmo");
    await page.goto("/noticias/25-conquistas-mais-raras-da-steam-em-2026");
    const comment = page.locator("#comentario-seed-comment-01");
    const like = comment.getByRole("button", { name: /^Curtir comentário de @Escudeiro_Tadeu/ }).first();
    const pressed = (await like.getAttribute("aria-pressed")) === "true";
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && Boolean(r.request().headers()["next-action"]));
    await like.click();
    await saved;
    await expect(like).toHaveAttribute("aria-pressed", String(!pressed));
    await page.reload();
    await expect(
      page.locator("#comentario-seed-comment-01").getByRole("button", { name: /^Curtir comentário de @Escudeiro_Tadeu/ }).first(),
    ).toHaveAttribute("aria-pressed", String(!pressed));

    const reply = `Concordo, ótima lista (${run})`;
    await page.locator("#comentario-seed-comment-01").getByRole("button", { name: "Responder a @Escudeiro_Tadeu" }).first().click();
    await page.getByRole("textbox", { name: "Responder a @Escudeiro_Tadeu" }).fill(reply);
    await page.locator("#comentario-seed-comment-01").getByRole("button", { name: "Responder", exact: true }).click();
    const replies = page.getByRole("list", { name: "Respostas ao comentário de @Escudeiro_Tadeu" });
    await expect(replies).toContainText(reply);

    await loginAs(page, "Escudeiro_Tadeu");
    await page.reload();
    const mine = page.getByRole("listitem").filter({ hasText: reply }).last();
    await mine.getByRole("button", { name: "Útil" }).click();
    await expect(mine.getByRole("status")).toContainText("Marcada como útil");
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: reply }).last()).toContainText("Útil");
  });

  test("a heavily disliked comment is collapsed behind 'Ver mesmo assim'", async ({ page }) => {
    await sql(`update "Comment" set "dislikeCount" = 6 where id = 'seed-comment-03'`);
    try {
      await page.goto("/noticias/hollow-knight-guia-100-por-cento-em-7-etapas");
      const item = page.locator("#comentario-seed-comment-03");
      await expect(item).toContainText("Recolhido por receber muitas descurtidas.");
      await expect(item).not.toContainText("A nova ordem das etapas");
      await item.getByRole("button", { name: "Ver mesmo assim" }).click();
      await expect(item).toContainText("A nova ordem das etapas");
    } finally {
      await sql(`update "Comment" set "dislikeCount" = (select count(*) from "Reaction" r where r."targetType" = 'comment' and r."targetId" = 'seed-comment-03' and r.value = -1) where id = 'seed-comment-03'`);
    }
  });

  test("feed: activity of followed public profiles", async ({ page }) => {
    const [lucas, joaquim] = await Promise.all([userId("lucas"), userId("Cacador_Joaquim")]);
    await sql(`insert into "Follow" ("followerId", "followeeId") values ($1, $2) on conflict do nothing`, [lucas, joaquim]);
    await loginAs(page, "lucas");
    await page.goto("/feed");
    await expect(page.getByRole("list", { name: "Atividade de quem você segue" })).toContainText("Pôr do sol nas Terras Intermédias");
    await expectNoBlockingAxe(page);
  });
});
