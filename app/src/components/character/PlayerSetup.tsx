import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import {
  FAMILY_BY_ID,
  groupPlatforms,
  PC_FIELDS,
  PC_GROUP_LABEL,
  setupPlatform,
  type PcFieldGroup,
  type PcSpecs,
  type SetupPlatform,
} from "@/lib/setup/catalog";
import type { PlayerSetup } from "@/lib/setup/queries";
import { CardHead } from "./CardHead";

const EDIT_HREF = "/conta/setup";

/** Notched corners (top-left and bottom-right), the cut of a cartridge label. */
const NOTCH = "polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)";

type PlayerSetupSectionProps = {
  setup: PlayerSetup;
  displayName: string;
  isOwner: boolean;
};

/**
 * The player's setup on the profile: owned platforms as seals grouped by family, and the PC spec
 * sheet when filled. Visitors see nothing for an empty setup; the owner sees an invitation.
 */
export function PlayerSetupSection({ setup, displayName, isOwner }: PlayerSetupSectionProps) {
  const platforms = setup.platforms.flatMap((id) => setupPlatform(id) ?? []);
  if (platforms.length === 0 && !setup.pc) return isOwner ? <SetupInvite /> : null;

  const both = platforms.length > 0 && setup.pc !== null;
  return (
    <div className={`grid gap-5 ${both ? "min-[901px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : ""}`}>
      {platforms.length > 0 ? (
        <PlatformSeals platforms={platforms} displayName={displayName} isOwner={isOwner} />
      ) : null}
      {setup.pc ? <PcSpecSheet specs={setup.pc} isOwner={isOwner} /> : null}
    </div>
  );
}

function EditLink({ children }: { children: ReactNode }) {
  return (
    <Link href={EDIT_HREF} className="text-acc hover:underline hover:underline-offset-4">
      {children}
    </Link>
  );
}

function PlatformSeals({
  platforms,
  displayName,
  isOwner,
}: {
  platforms: SetupPlatform[];
  displayName: string;
  isOwner: boolean;
}) {
  const count = `${platforms.length} ${platforms.length === 1 ? "plataforma" : "plataformas"}`;
  return (
    <Card>
      <CardHead title="Setup" aside={isOwner ? <EditLink>Editar setup</EditLink> : count} />
      <div className="mt-4 flex flex-wrap gap-x-7 gap-y-5">
        {groupPlatforms(platforms).map(({ family, platforms: items }) => (
          <div
            key={family.id}
            className="flex min-w-0 flex-col gap-2"
            style={{ "--c": family.color } as CSSProperties}
          >
            <h3 className="flex items-center gap-2 font-mono text-xs tracking-[0.14em] text-(--c) uppercase">
              <span aria-hidden="true" className="size-[7px] rotate-45 bg-(--c)" />
              {family.label}
            </h3>
            <ul aria-label={`${family.label} de ${displayName}`} className="m-0 flex list-none flex-wrap gap-2 p-0">
              {items.map((platform) => (
                <li key={platform.id}>
                  <PlatformSeal platform={platform} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** One owned platform: a notched plate in the family color with its short mark and launch year. */
export function PlatformSeal({ platform }: { platform: SetupPlatform }) {
  const color = FAMILY_BY_ID.get(platform.family)?.color ?? "var(--text-3)";
  return (
    <span
      title={platform.year ? `${platform.name} (${platform.year})` : platform.name}
      className="relative grid h-[66px] min-w-[78px] place-content-center px-3.5 text-center"
      style={{ "--c": color, clipPath: NOTCH, background: "color-mix(in oklch, var(--c) 70%, transparent)" } as CSSProperties}
    >
      {/* 1px frame: the colored plate shows around this inner face. */}
      <span
        aria-hidden="true"
        className="absolute inset-px"
        style={{
          clipPath: NOTCH,
          background:
            "linear-gradient(160deg, color-mix(in oklch, var(--c) 26%, var(--surface-2)) 0%, var(--surface-2) 58%, color-mix(in oklch, var(--c) 8%, var(--bg)) 100%)",
        }}
      />
      <span aria-hidden="true" className="absolute inset-x-[10px] top-px h-[2px] bg-(--c)" />
      <span
        aria-hidden="true"
        className="relative text-[19px] leading-none font-black font-stretch-[125%] tracking-[-0.02em] whitespace-nowrap text-(--c) uppercase"
      >
        {platform.code}
      </span>
      {platform.year ? (
        <span aria-hidden="true" className="relative mt-1.5 font-mono text-xs tracking-[0.12em] text-dim tabular-nums">
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

const HERO_KEYS = ["cpu", "gpu"] as const;

function PcSpecSheet({ specs, isOwner }: { specs: PcSpecs; isOwner: boolean }) {
  const hero = PC_FIELDS.filter((field) => (HERO_KEYS as readonly string[]).includes(field.key) && specs[field.key]);
  const rest = PC_FIELDS.filter((field) => !(HERO_KEYS as readonly string[]).includes(field.key) && specs[field.key]);
  const groups = (["machine", "peripherals"] as PcFieldGroup[])
    .map((group) => ({ group, fields: rest.filter((field) => field.group === group) }))
    .filter((entry) => entry.fields.length > 0);

  return (
    <Card>
      <CardHead title="Ficha técnica" aside={isOwner ? <EditLink>Editar ficha</EditLink> : "PC"} />
      {hero.length > 0 ? (
        <dl
          className={`m-0 mt-4 grid gap-px overflow-hidden rounded-[2px] border border-line bg-line ${
            hero.length === 2 ? "grid-cols-2" : ""
          }`}
        >
          {hero.map((field) => (
            <div key={field.key} className="min-w-0 bg-surface-2 px-3.5 py-3">
              <dt className="font-mono text-xs tracking-[0.12em] text-pc uppercase">{field.label}</dt>
              <dd className="m-0 mt-1 text-[15.5px] leading-snug font-extrabold font-stretch-[112%] break-words">
                {specs[field.key]}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {groups.map(({ group, fields }) => (
        <div key={group} className="mt-4">
          <h3 className="font-mono text-xs tracking-[0.14em] text-dim-2 uppercase">{PC_GROUP_LABEL[group]}</h3>
          <dl className="m-0 mt-1">
            {fields.map((field) => (
              <div
                key={field.key}
                className="flex items-baseline justify-between gap-4 border-b border-divider py-2 last:border-b-0"
              >
                <dt className="flex-none font-mono text-xs tracking-[0.1em] text-dim uppercase">{field.label}</dt>
                <dd className="m-0 min-w-0 text-right text-[14.5px] break-words text-text-2">{specs[field.key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </Card>
  );
}

const SAMPLE_SEALS = ["ps5", "switch", "pc"];

/** Empty setup, seen by the owner: faded sample seals and the way to fill it. */
function SetupInvite() {
  return (
    <Card className="flex flex-wrap items-center gap-x-8 gap-y-5">
      <ul aria-hidden="true" className="m-0 flex list-none gap-2 p-0 opacity-45 grayscale-[35%]">
        {SAMPLE_SEALS.flatMap((id) => setupPlatform(id) ?? []).map((platform) => (
          <li key={platform.id}>
            <PlatformSeal platform={platform} />
          </li>
        ))}
      </ul>
      <div className="flex min-w-[240px] flex-1 flex-col items-start gap-2">
        <h2 className="text-[19px] leading-[1.05] font-black font-stretch-[125%] tracking-[-0.02em] uppercase">
          Monte seu setup
        </h2>
        <p className="max-w-[52ch] text-sm text-muted">
          Marque os consoles que você tem, do Atari ao PS5, e preencha a ficha técnica do seu PC.
          Eles aparecem aqui, na sua ficha de personagem.
        </p>
        <Link
          href={EDIT_HREF}
          className="mt-1 inline-flex h-11 items-center justify-center rounded-[2px] border border-acc bg-acc px-[18px] font-mono text-xs font-bold tracking-[0.1em] text-bg uppercase hover:brightness-[1.08]"
        >
          Montar setup
        </Link>
      </div>
    </Card>
  );
}
