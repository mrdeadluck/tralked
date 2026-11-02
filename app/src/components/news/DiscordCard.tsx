import type { ReactNode } from "react";

/** Invite link of the community server; without one the card says "Em breve" and links nowhere. */
const INVITE_URL = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL;

/** Two speech bubbles (a group chat), in white on the Discord blurple tile. */
function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="square">
      <path d="M3 4h12v9H8l-3 3v-3H3z" />
      <path d="M18 8h3v9h-2v3l-3-3h-6v-2" />
    </svg>
  );
}

/**
 * "Comunidade no Discord": a dark card of the system with the Discord blurple only on its mark.
 * It links out once there is an invite URL (NEXT_PUBLIC_DISCORD_INVITE_URL); until then it says so.
 */
export function DiscordCard() {
  const body: ReactNode = (
    <>
      <span aria-hidden="true" className="grid size-12 flex-none place-items-center rounded-[4px] bg-discord text-white">
        <ChatGlyph />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <b className="text-[17px] leading-tight font-extrabold">Comunidade no Discord</b>
        <span className="text-[14px] text-muted">Monte grupos para conquistas co-op.</span>
      </span>
      {INVITE_URL ? (
        <span aria-hidden="true" className="font-mono text-lg text-text-3 transition-[translate,color] duration-200 ease-out group-hover:translate-x-1 group-hover:text-text">
          →
        </span>
      ) : (
        <span className="flex-none rounded-[2px] border border-line-2 px-2 py-0.5 font-mono text-xs tracking-[0.1em] text-text-3 uppercase">
          Em breve
        </span>
      )}
    </>
  );
  const frame = "flex items-center gap-4 rounded-[4px] border border-line bg-surface p-[18px]";
  return INVITE_URL ? (
    <a
      href={INVITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`group ${frame} transition-[border-color,translate] duration-200 ease-out hover:-translate-y-0.5 hover:border-discord motion-reduce:transition-none`}
    >
      {body}
      <span className="sr-only"> (abre em nova aba)</span>
    </a>
  ) : (
    <div className={frame}>{body}</div>
  );
}
