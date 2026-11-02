import Link from "next/link";
import { ReportButton } from "@/components/community/ReportButton";

type ProfileModerationProps = {
  userId: string;
  handle: string;
  loggedIn: boolean;
  /** Moderators get a link to mute or ban (the action checks the role again). */
  moderator: boolean;
};

/** Under someone else's character sheet: "Denunciar" and, for moderators, "Punir". */
export function ProfileModeration({ userId, handle, loggedIn, moderator }: ProfileModerationProps) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
      <ReportButton targetType="user" targetId={userId} loggedIn={loggedIn} returnTo={`/jogador/${handle}`} what={`o perfil de @${handle}`} />
      {moderator ? (
        <Link
          href={`/admin/moderacao?aba=punicoes&usuario=${encodeURIComponent(handle)}`}
          className="font-mono text-xs tracking-[0.06em] text-dim uppercase hover:text-text"
        >
          Silenciar ou banir
        </Link>
      ) : null}
    </div>
  );
}
