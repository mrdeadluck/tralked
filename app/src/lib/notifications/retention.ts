import { prisma } from "@/lib/db";

/**
 * Notifications are ephemeral UI. Their title/body can quote other people (a handle, a comment
 * excerpt), including people who deleted their account, so they are kept for 90 days only.
 */
export const NOTIFICATION_RETENTION_DAYS = 90;

/** Daily cron job: deletes every notification older than the retention window. */
export async function deleteOldNotifications(now: Date = new Date()): Promise<{ processed: number }> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { processed: count };
}
