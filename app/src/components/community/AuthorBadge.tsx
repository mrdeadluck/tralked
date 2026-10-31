import Link from "next/link";
import type { AuthorView } from "@/lib/community/comments";

/** Avatar + @handle for community content; "Conta removida" when the author deleted their account. */
export function AuthorBadge({ author, size = 32 }: { author: AuthorView; size?: number }) {
  const avatar = author?.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- Steam avatar hosts are not configured for next/image
    <img src={author.avatarUrl} alt="" width={size} height={size} className="rounded-full object-cover" />
  ) : (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, background: "var(--stripes)" }}
      className="block rounded-full"
    />
  );
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <span className="flex-none">{avatar}</span>
      {author ? (
        <Link
          href={`/jogador/${encodeURIComponent(author.handle)}`}
          className="truncate font-mono text-[12px] text-text-2 hover:text-acc"
        >
          @{author.handle}
        </Link>
      ) : (
        <span className="font-mono text-[12px] text-dim">Conta removida</span>
      )}
    </span>
  );
}
