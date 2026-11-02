import { cache } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { canModerate } from "@/lib/moderation/permissions";

/** The logged-in user, read once per request and shared by every community island on the page. */
export const currentUser = cache(getSessionUser);

/**
 * What client components need to know about the visitor. `moderator` only decides which controls
 * render: every moderation action checks the role again on the server.
 */
export type Viewer = { id: string; handle: string; moderator?: boolean } | null;

export async function currentViewer(): Promise<Viewer> {
  const user = await currentUser();
  return user ? { id: user.id, handle: user.handle, moderator: canModerate(user.role) } : null;
}
