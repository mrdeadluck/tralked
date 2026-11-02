/** XP for each gallery photo (photos are approved on upload; moderation can hide them later). */
export const PHOTO_XP = 50;
/** At most this many photos per user per day (America/Sao_Paulo) earn XP. */
export const PHOTO_XP_DAILY_CAP = 3;
/** XP for the author of a forum reply marked "Resolveu", all of it in Sábio (Sabedoria). */
export const FORUM_SOLVED_XP = 40;
/** XP credited to a guide tip's author for each distinct "útil" vote, all of it in Sábio. */
export const TIP_VOTE_XP = 25;
/** XP for giving a like or a dislike: once per item ever (undo/redo pays nothing new). */
export const REACTION_GIVEN_XP = 5;
/** XP for the author of an item each time a different person likes it (dislikes pay nothing). */
export const REACTION_RECEIVED_XP = 10;
/** At most this many reactions per user per day (America/Sao_Paulo) pay `REACTION_GIVEN_XP`. */
export const REACTION_GIVEN_DAILY_CAP = 20;
/** At most this many received likes per user per day pay `REACTION_RECEIVED_XP`. */
export const REACTION_RECEIVED_DAILY_CAP = 50;
