import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarHead, PersonalCalendar, PublicCalendar } from "@/components/calendar/CalendarPage";

export const metadata: Metadata = {
  title: "Calendário | Tralked",
  description: "Matérias publicadas, lançamentos de jogos e, com a sua conta, as suas conquistas e marcos de horas, dia a dia.",
  alternates: { canonical: "/calendario" },
};

/** This month. Without JavaScript the public month (the fallback, in the static shell) stays. */
export default function CalendarioPage({ searchParams }: PageProps<"/calendario">) {
  return (
    <div className="flex flex-col gap-8">
      <CalendarHead />
      <Suspense fallback={<PublicCalendar month={null} />}>
        <PersonalCalendar month={null} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
