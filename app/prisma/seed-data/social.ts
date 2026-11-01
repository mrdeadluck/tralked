/**
 * Social example data (Plano 4, F9): follows, friendships, a threaded reply, reactions and a private
 * conversation. Reactions here only set the counters: they are example data, not paid likes (the
 * ledger stays as the preview's, so the seeded levels do not move).
 */

/** [follower, followed] */
export const FOLLOWS: [string, string][] = [
  ["lucas", "Cacador_Joaquim"],
  ["lucas", "Herbalista_Rosa"],
  ["lucas", "Escriba_Odete"],
  ["lucas", "Escudeiro_Tadeu"],
  ["Herbalista_Rosa", "lucas"],
  ["Cacador_Joaquim", "lucas"],
  ["Escudeiro_Tadeu", "Escriba_Odete"],
];

/** Friendships: `accepted` false = request from `from`, waiting for `to`. */
export const FRIENDSHIPS: { from: string; to: string; accepted: boolean; agoHours: number }[] = [
  { from: "lucas", to: "Herbalista_Rosa", accepted: true, agoHours: 300 },
  { from: "Cacador_Joaquim", to: "lucas", accepted: false, agoHours: 5 },
];

/** Replies to seeded comments and forum posts (ids stable, so the seed stays idempotent). */
export const COMMENT_REPLIES: { id: string; parentId: string; authorHandle: string; body: string; agoHours: number; helpful?: boolean }[] = [
  {
    id: "seed-comment-10",
    parentId: "seed-comment-02",
    authorHandle: "Escriba_Odete",
    body: "Verdade. A do Panteão leva umas 40 horas só de treino.",
    agoHours: 1.2,
    helpful: true,
  },
  {
    id: "seed-comment-11",
    parentId: "seed-comment-10",
    authorHandle: "Cacador_Joaquim",
    body: "Obrigado, vou separar um fim de semana para ela.",
    agoHours: 1.1,
  },
];

export const POST_REPLIES: { id: string; threadId: string; parentId: string; authorHandle: string; body: string; agoHours: number }[] = [
  {
    id: "seed-post-2-4",
    threadId: "seed-thread-2",
    parentId: "seed-post-2-2",
    authorHandle: "Herbalista_Rosa",
    body: "Confirmo: fiz assim e deu certo nas duas.",
    agoHours: 25,
  },
];

/** [user, comment id, +1 | -1] */
export const COMMENT_REACTIONS: [string, string, 1 | -1][] = [
  ["lucas", "seed-comment-01", 1],
  ["Herbalista_Rosa", "seed-comment-01", 1],
  ["Escriba_Odete", "seed-comment-02", 1],
  ["lucas", "seed-comment-10", 1],
];

/** [user, forum post id, +1 | -1] */
export const POST_REACTIONS: [string, string, 1 | -1][] = [
  ["Escudeiro_Tadeu", "seed-post-2-2", 1],
  ["lucas", "seed-post-2-2", 1],
];

/** A private conversation between lucas and Herbalista_Rosa (the last message unread by lucas). */
export const CONVERSATION = {
  id: "seed-conversation-1",
  between: ["lucas", "Herbalista_Rosa"] as const,
  messages: [
    { id: "seed-dm-1", from: "lucas", body: "Bora tentar o Panteão 5 no sábado?", agoHours: 6 },
    { id: "seed-dm-2", from: "Herbalista_Rosa", body: "Bora! Levo a build de amuletos do fórum.", agoHours: 5 },
  ],
};
