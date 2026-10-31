import { cache } from "react";
import { getSessionUser } from "@/lib/auth/session";

/** The logged-in user, read once per request and shared by every community island on the page. */
export const currentUser = cache(getSessionUser);

/** What client components need to know about the visitor. */
export type Viewer = { id: string; handle: string } | null;

export async function currentViewer(): Promise<Viewer> {
  const user = await currentUser();
  return user ? { id: user.id, handle: user.handle } : null;
}
