import Link from "next/link";
import type { ProfileSummary } from "@/lib/profile/queries";
import { formatHours } from "./format";
import { profilePath } from "./ProfileTabs";

/** Compact player header of the profile sections (the full card lives on the sheet). */
export function ProfileHeader({ summary, section }: { summary: ProfileSummary; section: string }) {
  return (
    <header className="flex flex-wrap items-center gap-5">
      <div
        aria-hidden="true"
        className="grid size-16 flex-none place-items-center overflow-hidden rounded-full border-2 border-acc bg-surface-2 text-2xl leading-none font-black font-stretch-[125%] text-acc"
      >
        {summary.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar from the platform, external host
          <img src={summary.avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          summary.displayName.charAt(0).toUpperCase()
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-dim-2 uppercase">{section}</span>
        <h1 className="mt-1 text-[clamp(26px,3.4vw,36px)] leading-none font-black font-stretch-[125%] tracking-[-0.03em] break-words uppercase">
          <Link href={profilePath(summary.handle)} className="hover:text-acc">
            {summary.displayName}
          </Link>
        </h1>
        <p className="mt-1.5 font-mono text-[11px] tracking-[0.08em] text-dim uppercase">
          @{summary.handle} · <span className="text-acc">{summary.vocation}</span> · Nível {summary.level}
        </p>
      </div>
      <dl className="m-0 flex gap-px overflow-hidden rounded-[2px] border border-line bg-line">
        <div className="bg-surface px-4 py-2.5">
          <dt className="font-mono text-[10px] tracking-[0.12em] text-dim-2 uppercase">Horas jogadas</dt>
          <dd className="m-0 text-xl font-extrabold font-stretch-[112%] tabular-nums">{formatHours(summary.playtimeMin)}</dd>
        </div>
        <div className="bg-surface px-4 py-2.5">
          <dt className="font-mono text-[10px] tracking-[0.12em] text-dim-2 uppercase">Jogos</dt>
          <dd className="m-0 text-xl font-extrabold font-stretch-[112%] tabular-nums">
            {summary.gamesOwned.toLocaleString("pt-BR")}
          </dd>
        </div>
      </dl>
    </header>
  );
}
