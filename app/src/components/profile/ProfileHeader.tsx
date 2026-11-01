import Link from "next/link";
import { ProfileSocial } from "@/components/social/ProfileSocial";
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
      <div className="min-w-[180px] flex-1">
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
      <dl className="m-0 flex w-full gap-px overflow-hidden rounded-[2px] border border-line bg-line min-[641px]:w-auto">
        <Stat label="Horas jogadas" value={formatHours(summary.playtimeMin)} />
        <Stat label="Jogos" value={summary.gamesOwned.toLocaleString("pt-BR")} />
      </dl>
      <div className="w-full">
        <ProfileSocial user={{ id: summary.userId, handle: summary.handle, displayName: summary.displayName }} />
      </div>
    </header>
  );
}

/** One header number: value and unit never wrap; 5+ digit values use a slightly smaller size. */
function Stat({ label, value }: { label: string; value: string }) {
  const digits = value.replace(/\D/g, "").length;
  return (
    <div className="min-w-0 flex-1 bg-surface px-4 py-2.5 min-[641px]:flex-none">
      <dt className="font-mono text-[10px] tracking-[0.12em] whitespace-nowrap text-dim-2 uppercase">{label}</dt>
      <dd
        className={`m-0 font-extrabold font-stretch-[112%] whitespace-nowrap tabular-nums ${digits >= 5 ? "text-lg" : "text-xl"}`}
      >
        {value}
      </dd>
    </div>
  );
}
