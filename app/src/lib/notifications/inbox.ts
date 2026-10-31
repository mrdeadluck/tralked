import { prisma } from "@/lib/db";
import { isSiteRelativePath } from "@/lib/content/url";

/** Notifications in the header dropdown. */
export const BELL_LIMIT = 8;
/** Notifications per page on /notificacoes. */
export const INBOX_PAGE_SIZE = 30;

export type NotificationView = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  /** Same-site path only (stored hrefs are re-checked: never an external or script URL). */
  href: string | null;
  read: boolean;
  createdAt: Date;
};

export type BellData = { unread: number; items: NotificationView[] };

type Row = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
};

function toView(row: Row): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href && isSiteRelativePath(row.href) ? row.href : null,
    read: row.readAt !== null,
    createdAt: row.createdAt,
  };
}

const select = { id: true, kind: true, title: true, body: true, href: true, readAt: true, createdAt: true } as const;
const newestFirst = [{ createdAt: "desc" as const }, { id: "desc" as const }];

/** Unread count and the latest notifications for the header bell. */
export async function getBell(userId: string, limit = BELL_LIMIT): Promise<BellData> {
  const [unread, rows] = await Promise.all([
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.notification.findMany({ where: { userId }, orderBy: newestFirst, take: limit, select }),
  ]);
  return { unread, items: rows.map(toView) };
}

export type InboxPage = {
  items: NotificationView[];
  unread: number;
  page: number;
  pageCount: number;
  total: number;
};

/** One page of the user's notifications (out-of-range pages clamp to the last one). */
export async function getInbox(userId: string, page: number, pageSize = INBOX_PAGE_SIZE): Promise<InboxPage> {
  const [total, unread] = await Promise.all([
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: newestFirst,
    skip: (current - 1) * pageSize,
    take: pageSize,
    select,
  });
  return { items: rows.map(toView), unread, page: current, pageCount, total };
}

/** Marks every unread notification of the user as read. Returns how many changed. */
export async function markAllRead(userId: string, now: Date = new Date()): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: now },
  });
  return count;
}

/** Marks one notification as read, only if it belongs to the user. Returns false otherwise. */
export async function markRead(userId: string, id: string, now: Date = new Date()): Promise<boolean> {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: now },
  });
  if (count > 0) return true;
  return (await prisma.notification.count({ where: { id, userId } })) > 0;
}
