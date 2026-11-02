/** User roles (stored as text in User.role). Shared by the admin pages and their client widgets. */
export const ROLES = ["admin", "editor", "moderator", "author", "user"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  editor: "Editor",
  moderator: "Moderador",
  author: "Autor",
  user: "Jogador",
};
