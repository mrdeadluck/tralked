import type { ReactNode } from "react";
import { pctText } from "@/components/guide/format";
import type { Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideDetail, WalkExtras } from "@/lib/queries/games";
import { timeTo100Label } from "@/lib/queries/time-to-100";
import { formatCompact } from "@/lib/xp-format";
import { SpoilerAchievement } from "./spoilers";
import { Both, hasVersions, withSteamOnly } from "./versions";
import type { AchView, ItemView } from "./view";

/*
 * "A tabelinha": the 8 numbers of a walkthrough (difficulty, time to the Tralked, achievements,
 * minimum playthroughs, missables, online, bugged, the hardest) and, under them, the guide's XP.
 * The hardest achievement's name stays blurred while spoilers are off. In a guide with a PlayStation
 * version (versions.tsx), the achievements and the missables count that version's too, and the
 * hardest is one that also exists on PlayStation.
 */

type Field = {
  label: string;
  value: ReactNode;
  note: ReactNode;
  warn?: boolean;
  extra?: ReactNode;
  name?: boolean;
  /** The PlayStation version has nothing to show here. */
  steamOnly?: boolean;
};

type Hardest = Pick<AchView, "id" | "name" | "globalPct">;

/**
 * The PlayStation version's hardest: the Steam one when it is also on the PSN list, else the rarest
 * (lowest Steam rarity) of the achievements on both lists; null when none has a rarity.
 */
function psHardest(hardest: Hardest | null, items: ItemView[]): Hardest | null {
  const shared = items.flatMap((i) => (i.achievement && !i.steamOnly ? [i.achievement] : []));
  if (hardest && shared.some((a) => a.id === hardest.id)) return hardest;
  return shared.reduce<Hardest | null>(
    (best, a) => (a.globalPct !== null && (best === null || a.globalPct < best.globalPct!) ? a : best),
    null,
  );
}

function hardestName(a: Hardest | null, id: string) {
  return a ? <SpoilerAchievement id={id} achievementId={a.id} name={a.name} what="a conquista mais difícil" /> : "—";
}

const hardestNote = (a: Hardest | null) =>
  a ? `${pctText(a.globalPct)} dos jogadores na Steam` : "Sem raridade da Steam ainda.";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The guide's hours; null when it has no estimate (0/0): no number is invented. */
function hoursText({ min, max }: WalkExtras["hours"]): string | null {
  if (min <= 0 && max <= 0) return null;
  return min === max ? String(max) : `${min}–${max}`;
}

type FichaGridProps = {
  guide: GuideDetail;
  walkthrough: Walkthrough;
  walk: WalkExtras;
  /** The page's items (view.ts): which ones the PlayStation version leaves out. */
  items?: ItemView[];
};

export function FichaGrid({ guide, walkthrough, walk, items = [] }: FichaGridProps) {
  const { facts, game } = guide;
  const { extraFacts } = walkthrough;
  const players = facts.timeTo100?.source === "tralked" ? timeTo100Label(facts.timeTo100) : null;
  const asOf = game.guide.updatedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const hardest = walk.hardest;
  const hours = hoursText(walk.hours);
  // PlayStation: its list's size, and the missable achievements minus the Steam-only ones (facts.missables
  // counts the missable achievement items).
  const psn = hasVersions(guide) ? walk.compatCounts : null;
  const psMissables = psn
    ? Math.max(0, facts.missables - items.filter((i) => i.steamOnly && i.missable && i.kind === "achievement").length)
    : undefined;
  const psHard = psn ? psHardest(hardest, items) : undefined;
  const sameHardest = psHard !== undefined && psHard?.id === hardest?.id;
  const missablesNote = (n: number) => (n > 0 ? "Avisadas no caminho, antes do ponto sem volta." : "Nada fica para trás.");

  const fields: Field[] = [
    {
      label: "Dificuldade",
      value: (
        <>
          {facts.difficulty}
          <small>/10</small>
        </>
      ),
      extra: (
        <span className="wk-diff" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} className={i < facts.difficulty ? "on" : undefined} />
          ))}
        </span>
      ),
      note: extraFacts.difficultyNote,
    },
    {
      label: "Tempo até o Tralked",
      value: hours ? (
        <>
          {hours}
          <small> h</small>
        </>
      ) : (
        "—"
      ),
      note: players
        ? `Jogadores do Tralked: ${players.value} (${players.source}).`
        : hours
          ? "Estimativa do guia, seguindo o detonado."
          : "Sem estimativa de tempo ainda.",
    },
    {
      label: "Conquistas",
      value: <Both steam={game.achievementCount} ps={psn?.psn} />,
      note: (
        <Both
          steam={
            walk.hiddenCount > 0
              ? `Lista oficial da Steam · ${walk.hiddenCount} ${plural(walk.hiddenCount, "oculta", "ocultas")}`
              : "Lista oficial da Steam · nenhuma oculta"
          }
          ps={psn ? "Lista oficial de troféus do PlayStation" : undefined}
        />
      ),
    },
    { label: "Zeradas mínimas", value: facts.playthroughs, note: extraFacts.playthroughsNote },
    {
      label: "Perdíveis",
      value: <Both steam={facts.missables} ps={psMissables} />,
      warn: facts.missables > 0,
      note: (
        <Both
          steam={missablesNote(facts.missables)}
          ps={psMissables === undefined ? undefined : missablesNote(psMissables)}
        />
      ),
    },
    {
      label: "Online",
      value: facts.online,
      note: facts.online === 0 ? "Tralked 100% offline." : `${plural(facts.online, "Uma pede", "Pedem")} partida online.`,
    },
    {
      label: "Com bug",
      value: extraFacts.buggedCount,
      note: extraFacts.buggedCount === 0 ? `Nenhum relato até ${asOf}.` : "O detonado mostra como contornar.",
    },
    {
      label: "Mais difícil",
      name: true,
      value: (
        <Both
          steam={hardestName(hardest, "ficha-hardest")}
          ps={psHard && !sameHardest ? hardestName(psHard, "ficha-hardest-ps") : undefined}
        />
      ),
      note: <Both steam={hardestNote(hardest)} ps={psHard && !sameHardest ? hardestNote(psHard) : undefined} />,
      steamOnly: psHard === null,
    },
  ];

  return (
    <section className="wk-ficha tk-cut" aria-label="Ficha do guia">
      <dl>
        {fields.map((f) => (
          <div key={f.label} className={withSteamOnly(f.warn ? "wk-f warn" : "wk-f", Boolean(f.steamOnly))}>
            <dt className="wk-lbl">{f.label}</dt>
            <dd>
              <span className={f.name ? "v name" : "v"}>{f.value}</span>
              {f.extra}
              <span className="d">{f.note}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="wk-xp">
        <span className="wk-lbl">XP do guia</span>
        <span>
          <b>+{formatCompact(guide.totals.xp)} XP</b> nas {game.achievementCount} conquistas da Steam. Só a Steam
          confirma: marcar no guia não dá XP.
        </span>
      </p>
    </section>
  );
}
