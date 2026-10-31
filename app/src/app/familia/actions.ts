"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import {
  acceptInvite,
  createFamily,
  createInvite,
  FamilyError,
  getFamilyOverviewForUser,
  INVITE_ERROR_MESSAGES,
  leaveFamily,
} from "@/lib/family/service";

export type FormState = { error?: string };
export type InviteState = { url?: string; expiresAt?: string; error?: string };

const NOT_LOGGED_IN = "Entre na sua conta para usar a Família Tralked.";

export async function createFamilyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { error: NOT_LOGGED_IN };

  const name = String(formData.get("name") ?? "");
  try {
    await createFamily(user.id, name);
  } catch (error) {
    if (error instanceof FamilyError) return { error: error.message };
    throw error;
  }
  revalidatePath("/familia");
  redirect("/familia");
}

export async function createInviteAction(): Promise<InviteState> {
  const user = await getSessionUser();
  if (!user) return { error: NOT_LOGGED_IN };
  const family = await getFamilyOverviewForUser(user.id);
  if (!family) return { error: "Você ainda não faz parte de uma família." };

  try {
    const invite = await createInvite(family.id, user.id);
    return { url: invite.url, expiresAt: invite.expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof FamilyError) return { error: error.message };
    throw error;
  }
}

export async function acceptInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const user = await getSessionUser();
  if (!user) return { error: NOT_LOGGED_IN };

  const result = await acceptInvite(token, user.id);
  if (!result.ok) return { error: INVITE_ERROR_MESSAGES[result.reason] };
  revalidatePath("/familia");
  redirect("/familia");
}

export async function leaveFamilyAction(): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/familia");
  await leaveFamily(user.id);
  revalidatePath("/familia");
  redirect("/familia");
}
