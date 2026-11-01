import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getFeed } from "@/lib/social/feed";
import { FeedList } from "./FeedList";

/** Items of the home card. */
const HOME_FEED_ITEMS = 5;

/**
 * "De quem você segue" on the home page, for logged-in players who follow someone. Per visitor:
 * render it inside <Suspense> (it reads the session), outside every cached section.
 */
export async function HomeFeedCard() {
  const user = await getSessionUser();
  if (!user) return null;
  const feed = await getFeed(prisma, user.id, 1);
  if (feed.following === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">De quem você segue</h2>
        <Link href="/feed" className="font-mono text-[11px] tracking-[0.08em] text-acc uppercase hover:underline">
          Ver feed →
        </Link>
      </div>
      {feed.items.length > 0 ? (
        <FeedList items={feed.items.slice(0, HOME_FEED_ITEMS)} now={new Date()} compact />
      ) : (
        <p className="text-[14px] text-muted">Nada novo de quem você segue por enquanto.</p>
      )}
    </Card>
  );
}
