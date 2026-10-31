import { exportUserData } from "@/lib/accounts/export";
import { getSessionUser } from "@/lib/auth/session";

/** LGPD export: downloads the logged-in user's own data as JSON. 401 without a session. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Entre na sua conta para exportar seus dados." }, { status: 401 });
  }

  const data = await exportUserData(user.id);
  if (!data) return Response.json({ error: "Conta não encontrada." }, { status: 404 });

  const date = data.exportedAt.slice(0, 10);
  const safeHandle = user.handle.replace(/[^A-Za-z0-9_-]/g, "") || "conta";
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="tralked-${safeHandle}-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
