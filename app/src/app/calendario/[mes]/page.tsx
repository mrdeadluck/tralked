import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarHead, PersonalCalendar, PublicCalendar } from "@/components/calendar/CalendarPage";
import { monthLabel, monthOf, monthParam, parseMonth } from "@/lib/calendar/month";

/**
 * `/calendario/AAAA-MM`. The month in the path (not a query) lets each month be a cached page
 * whose static shell already holds the public month, so prev/next work without JavaScript. The
 * build prerenders the current month; the others are rendered on their first visit and cached.
 */
export function generateStaticParams() {
  return [{ mes: monthParam(monthOf(new Date())) }];
}

export async function generateMetadata({ params }: PageProps<"/calendario/[mes]">): Promise<Metadata> {
  const month = parseMonth((await params).mes);
  if (!month) return {};
  const label = monthLabel(month);
  return {
    title: `Calendário de ${label} | Tralked`,
    description: `Matérias publicadas e lançamentos de jogos de ${label}.`,
    alternates: { canonical: `/calendario/${monthParam(month)}` },
  };
}

export default async function CalendarioMesPage({ params, searchParams }: PageProps<"/calendario/[mes]">) {
  const month = parseMonth((await params).mes);
  if (!month) notFound();
  return (
    <div className="flex flex-col gap-8">
      <CalendarHead />
      <Suspense fallback={<PublicCalendar month={month} />}>
        <PersonalCalendar month={month} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
