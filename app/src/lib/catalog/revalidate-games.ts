/**
 * For scripts that change games outside Next (merges, redirects): asks the running site to expire
 * the games' cache tags through POST /api/revalidate-games. Reads APP_URL and CRON_SECRET from the
 * environment of the script.
 */
export async function revalidateGames(slugs: string[], env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  const secret = env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  const base = env.APP_URL ?? "https://tralked.com";
  for (let i = 0; i < slugs.length; i += 200) {
    const response = await fetch(new URL("/api/revalidate-games", base), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ slugs: slugs.slice(i, i + 200) }),
    });
    if (!response.ok) throw new Error(`revalidate-games answered ${response.status}`);
  }
}
