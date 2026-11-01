import { Suspense } from "react";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getRelationship, socialCounts } from "@/lib/social/relations";
import { SocialButtons } from "./SocialButtons";

type ProfileUser = { id: string; handle: string; displayName: string };

/**
 * Social bar of a profile (counts, follow, friendship, message, block, report). Per visitor, so it
 * streams in its own Suspense boundary and is never cached.
 */
export function ProfileSocial({ user }: { user: ProfileUser }) {
  return (
    <Suspense fallback={<div aria-hidden="true" className="h-[60px]" />}>
      <ProfileSocialIsland user={user} />
    </Suspense>
  );
}

async function ProfileSocialIsland({ user }: { user: ProfileUser }) {
  const viewer = await getSessionUser();
  const isOwner = viewer?.id === user.id;
  const [counts, relationship, target] = await Promise.all([
    socialCounts(prisma, user.id),
    viewer && !isOwner ? getRelationship(prisma, viewer.id, user.id) : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: user.id }, select: { profilePublic: true } }),
  ]);
  return (
    <SocialButtons
      user={user}
      counts={counts}
      relationship={relationship}
      loggedIn={viewer !== null}
      isOwner={isOwner}
      listsVisible={isOwner || target?.profilePublic === true}
    />
  );
}
