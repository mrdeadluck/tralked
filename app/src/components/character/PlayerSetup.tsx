import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  FAMILY_BY_ID,
  groupPlatforms,
  PC_FIELDS,
  PC_GROUP_LABEL,
  setupPlatform,
  type PcFieldGroup,
  type PcFieldKey,
  type PcSpecs,
  type SetupPlatform,
} from "@/lib/setup/catalog";
import type { PlayerSetup } from "@/lib/setup/queries";
import { DuoFill } from "./AttributeIcon";
import { Panel, PANEL_LINK } from "./Panel";

const EDIT_HREF = "/conta/setup";

type PlayerSetupSectionProps = {
  setup: PlayerSetup;
  displayName: string;
  isOwner: boolean;
};

/**
 * The player's setup on the profile: owned platforms as seals grouped by family, and the PC spec
 * sheet ("Ficha técnica") when filled, in one panel. Visitors see nothing for an empty setup; the
 * owner sees an invitation.
 */
export function PlayerSetupSection({ setup, displayName, isOwner }: PlayerSetupSectionProps) {
  const platforms = setup.platforms.flatMap((id) => setupPlatform(id) ?? []);
  if (platforms.length === 0 && !setup.pc) return isOwner ? <SetupInvite /> : null;

  const count = `${platforms.length} ${platforms.length === 1 ? "plataforma" : "plataformas"}`;
  return (
    <Panel
      title="Setup"
      aside={
        isOwner ? (
          <Link href={EDIT_HREF} className={PANEL_LINK}>
            Editar setup
          </Link>
        ) : platforms.length > 0 ? (
          count
        ) : null
      }
    >
      {platforms.length > 0 ? <PlatformSeals platforms={platforms} displayName={displayName} /> : null}
      {setup.pc ? <PcSpecSheet specs={setup.pc} spaced={platforms.length > 0} /> : null}
    </Panel>
  );
}

function PlatformSeals({ platforms, displayName }: { platforms: SetupPlatform[]; displayName: string }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-4">
      {groupPlatforms(platforms).map(({ family, platforms: items }) => (
        <div key={family.id} className="flex min-w-0 flex-col gap-2" style={{ "--c": family.color } as CSSProperties}>
          <h3 className="flex items-center gap-2 tk-lbl text-text-2">
            <span aria-hidden="true" className="size-1.5 bg-(--c)" />
            {family.label}
          </h3>
          <ul aria-label={`${family.label} de ${displayName}`} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {items.map((platform) => (
              <li key={platform.id}>
                <PlatformSeal platform={platform} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** One owned platform: a graphite plate with the 45° cut, its short mark and launch year. */
export function PlatformSeal({ platform }: { platform: SetupPlatform }) {
  const color = FAMILY_BY_ID.get(platform.family)?.color ?? "var(--text-3)";
  return (
    <span
      title={platform.year ? `${platform.name} (${platform.year})` : platform.name}
      className="relative grid h-[58px] min-w-[70px] place-content-center bg-surface-2 px-3 text-center tk-cut-sm"
      style={{ "--c": color } as CSSProperties}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] bg-(--c)" />
      <span
        aria-hidden="true"
        className="text-[17px] leading-none font-black font-stretch-[112%] tracking-[-0.02em] whitespace-nowrap text-text uppercase"
      >
        {platform.code}
      </span>
      {platform.year ? (
        <span aria-hidden="true" className="mt-1 text-xs font-semibold text-muted tabular-nums">
          {platform.year}
        </span>
      ) : null}
      <span className="sr-only">
        {platform.name}
        {platform.year ? `, ${platform.year}` : ""}
      </span>
    </span>
  );
}

/** Duotone marks of the spec rows (others share the generic chip). */
const SPEC_ICON: Partial<Record<PcFieldKey, ReactNode>> = {
  cpu: (
    <>
      <DuoFill>
        <path d="M7 7h10v10H7z" />
      </DuoFill>
      <path d="M7 7h10v10H7zM10 10h4v4h-4zM9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />
    </>
  ),
  gpu: (
    <>
      <DuoFill>
        <path d="M2.5 6h19v11h-19z" />
      </DuoFill>
      <path d="M2.5 6h19v11h-19zM5 17v3M9 17v3" />
      <circle cx="9" cy="11.5" r="3" />
      <circle cx="16.5" cy="11.5" r="2" />
    </>
  ),
  ram: (
    <>
      <DuoFill>
        <path d="M3 7h18v8H3z" />
      </DuoFill>
      <path d="M3 7h18v8H3zM6.5 10h2v2h-2zM11 10h2v2h-2zM15.5 10h2v2h-2zM6 15v3M10 15v3M14 15v3M18 15v3" />
    </>
  ),
  case: (
    <>
      <DuoFill>
        <path d="M7 2.5h10v19H7z" />
      </DuoFill>
      <path d="M7 2.5h10v19H7zM10 6h4M10 9h4" />
      <circle cx="12" cy="16" r="2" />
    </>
  ),
  monitor: (
    <>
      <DuoFill>
        <path d="M3 4h18v12H3z" />
      </DuoFill>
      <path d="M3 4h18v12H3zM8 20.5h8M12 16v4.5" />
    </>
  ),
};

const GENERIC_SPEC = (
  <>
    <DuoFill>
      <path d="M5 5h14v14H5z" />
    </DuoFill>
    <path d="M5 5h14v14H5zM9 12h6" />
  </>
);

function PcSpecSheet({ specs, spaced }: { specs: PcSpecs; spaced: boolean }) {
  const groups = (["machine", "peripherals"] as PcFieldGroup[])
    .map((group) => ({ group, fields: PC_FIELDS.filter((field) => field.group === group && specs[field.key]) }))
    .filter((entry) => entry.fields.length > 0);

  return (
    <div className={spaced ? "mt-4" : ""}>
      <h3 className="mb-2 tk-lbl text-text-2">Ficha técnica · PC</h3>
      {groups.map(({ group, fields }) => (
        <div key={group} className="mt-2 first-of-type:mt-0">
          {groups.length > 1 ? <h4 className="mb-1 text-xs font-semibold text-muted">{PC_GROUP_LABEL[group]}</h4> : null}
          <dl className="m-0 grid gap-0.5">
            {fields.map((field) => (
              <div key={field.key} className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 bg-surface-2 py-1.5 pr-2.5 pl-1.5">
                <span aria-hidden="true" className="grid size-[34px] place-items-center bg-track text-text-2 tk-cut-sm">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="square"
                  >
                    {SPEC_ICON[field.key] ?? GENERIC_SPEC}
                  </svg>
                </span>
                <span className="min-w-0">
                  <dt className="tk-lbl">{field.label}</dt>
                  <dd className="m-0 text-[14.5px] leading-snug font-extrabold break-words">{specs[field.key]}</dd>
                </span>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

const SAMPLE_SEALS = ["ps5", "switch", "pc"];

/** Empty setup, seen by the owner: faded sample seals and the way to fill it. */
function SetupInvite() {
  return (
    <Panel title="Monte seu setup">
      <ul aria-hidden="true" className="m-0 flex list-none gap-1.5 p-0 opacity-45">
        {SAMPLE_SEALS.flatMap((id) => setupPlatform(id) ?? []).map((platform) => (
          <li key={platform.id}>
            <PlatformSeal platform={platform} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-text-2">
        Marque os consoles que você tem, do Atari ao PS5, e preencha a ficha técnica do seu PC. Eles aparecem
        aqui, na sua ficha de personagem.
      </p>
      <Link
        href={EDIT_HREF}
        className="mt-3 inline-flex min-h-[42px] items-center justify-center bg-acc px-[18px] text-[13.5px] font-extrabold font-stretch-[80%] tracking-[0.06em] text-acc-ink uppercase tk-cut-b hover:brightness-[1.08]"
      >
        Montar setup
      </Link>
    </Panel>
  );
}
