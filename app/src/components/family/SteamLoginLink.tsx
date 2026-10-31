/** Starts the Steam OpenID login and comes back to `returnTo` (a same-origin path). */
export function SteamLoginLink({ returnTo }: { returnTo: string }) {
  return (
    // A route handler redirect, so a plain anchor (not next/link) is the right element.
    <a
      href={`/api/auth/steam?returnTo=${encodeURIComponent(returnTo)}`}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
    >
      Entrar com a Steam
    </a>
  );
}
