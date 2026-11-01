import { cacheLife, cacheTag } from "next/cache";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHead } from "@/components/community/PageHead";
import { loginHref } from "@/components/guide/format";
import { getSessionUser } from "@/lib/auth/session";
import { getPersonalMonth, getPublicMonth, type CalendarEvent, type CalendarEventKind } from "@/lib/calendar/events";
import { dayKey, monthOf, monthParam, type Month } from "@/lib/calendar/month";
import { NEWS_TAG } from "@/lib/queries/news";
import { getPlayerHeader } from "@/lib/queries/players";
import { RELEASES_TAG } from "@/lib/queries/releases";
import { MonthView } from "./MonthView";

/**
 * /calendario (Plano 4, F8). The public month (articles and releases) is cached and rendered in
 * the static shell as the fallback of a Suspense boundary, so it is complete without JavaScript.
 * The boundary itself renders the same month plus the personal layer (it reads the session):
 * the signed-in player's achievements, hours milestones and missions, or, with `?jogador=`, those
 * of another player whose profile is public.
 */

const PUBLIC_KINDS: CalendarEventKind[] = ["release", "article"];
const PERSONAL_KINDS: CalendarEventKind[] = ["release", "article", "mission", "playtime", "unlock"];

/** Public events of a month, cached per month (refreshed with the news and the releases). */
async function publicMonth(month: Month): Promise<CalendarEvent[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(NEWS_TAG, RELEASES_TAG, `calendar:${monthParam(month)}`);
  return getPublicMonth(month);
}

export function CalendarHead() {
  return (
    <PageHead
      title="Calendário"
      lede="O que saiu e o que vem por aí: matérias publicadas, lançamentos de jogos e, com a sua conta, as suas conquistas, marcos de horas e missões, dia a dia."
      aside={
        <Link href="/lancamentos" className="text-acc uppercase hover:underline">
          Lançamentos →
        </Link>
      }
    />
  );
}

/** The public month (no session): cached, part of the static shell. `month` null = this month. */
export async function PublicCalendar({ month }: { month: Month | null }) {
  "use cache";
  cacheLife("hours");
  cacheTag(NEWS_TAG, RELEASES_TAG);
  const now = new Date();
  const shown = month ?? monthOf(now);
  return (
    <MonthView
      key={`cal-${monthParam(shown)}`}
      month={shown}
      todayKey={dayKey(now)}
      events={await publicMonth(shown)}
      kinds={PUBLIC_KINDS}
      idSuffix="p"
    />
  );
}

type Subject = { id: string; handle: string; self: boolean };

async function resolveSubject(jogador: string | undefined, returnTo: string): Promise<{ subject: Subject | null; note: ReactNode }> {
  const viewer = await getSessionUser();
  const handle = jogador?.trim().replace(/^@/, "");
  if (handle) {
    const player = await getPlayerHeader(handle);
    if (!player) return { subject: null, note: <>Não encontramos o jogador @{handle}. Mostrando só as datas públicas.</> };
    if (player.id === viewer?.id) return { subject: { id: player.id, handle: player.handle, self: true }, note: null };
    if (!player.profilePublic) {
      return { subject: null, note: <>O perfil de @{player.handle} é privado: só as datas públicas aparecem.</> };
    }
    return {
      subject: { id: player.id, handle: player.handle, self: false },
      note: (
        <>
          Conquistas, marcos de horas e missões de{" "}
          <Link href={`/jogador/${player.handle}`} className="text-acc underline underline-offset-2">
            @{player.handle}
          </Link>
          .{" "}
          {viewer ? (
            <Link href="/calendario" className="underline underline-offset-2">
              Ver o meu
            </Link>
          ) : null}
        </>
      ),
    };
  }
  if (viewer) return { subject: { id: viewer.id, handle: viewer.handle, self: true }, note: <>Com as suas conquistas, marcos de horas e missões.</> };
  return {
    subject: null,
    note: (
      <>
        <a href={loginHref(returnTo)} className="text-acc underline underline-offset-2">
          Entre
        </a>{" "}
        para ver também as suas conquistas, marcos de horas e missões.
      </>
    ),
  };
}

/** The month for this visitor (dynamic: reads the session and `?jogador=`). */
export async function PersonalCalendar({
  month,
  searchParams,
}: {
  month: Month | null;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const jogador = Array.isArray(params.jogador) ? params.jogador[0] : params.jogador;
  const path = month ? `/calendario/${monthParam(month)}` : "/calendario";
  const { subject, note } = await resolveSubject(jogador, path);
  const now = new Date();
  const shown = month ?? monthOf(now);
  const [publicEvents, personal] = await Promise.all([
    publicMonth(shown),
    subject ? getPersonalMonth(subject.id, shown) : Promise.resolve([]),
  ]);
  const query = subject && !subject.self ? `?jogador=${encodeURIComponent(subject.handle)}` : "";
  return (
    <MonthView
      month={shown}
      todayKey={dayKey(now)}
      events={[...publicEvents, ...personal]}
      kinds={subject ? PERSONAL_KINDS : PUBLIC_KINDS}
      query={query}
      subject={note}
      idSuffix="v"
    />
  );
}
