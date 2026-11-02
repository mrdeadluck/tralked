"use server";

import { getSessionUser } from "@/lib/auth/session";
import { savePlayerSetup, type PlayerSetup } from "@/lib/setup/queries";
import { issueField, playerSetupSchema } from "@/lib/setup/schema";

export type SetupActionResult =
  | { ok: true; setup: PlayerSetup }
  | { ok: false; error: string; /** "platforms" or "pc.<field>" when one field is wrong. */ field?: string };

/**
 * Saves the logged-in player's setup (owned platforms and PC spec sheet). Returns the stored,
 * cleaned values so the form shows exactly what the profile will show. The profile page reads the
 * setup on every request (it is not in a cached segment), so there is no cache tag to update.
 */
export async function updatePlayerSetupAction(input: unknown): Promise<SetupActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Entre na sua conta para continuar." };
  const parsed = playerSetupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos.", field: issueField(parsed.error) };
  }
  try {
    await savePlayerSetup(user.id, parsed.data);
  } catch (error) {
    console.error("updatePlayerSetupAction failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "Não deu para salvar o setup agora. Tente de novo em instantes." };
  }
  return { ok: true, setup: { platforms: parsed.data.platforms, pc: parsed.data.pc } };
}
