"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminNavItem = {
  href: string;
  label: string;
  /** Items waiting in this section's queue (shown when > 0). */
  count?: number;
};

/** Section rail of the admin: a column on desktop, a scrollable row on small screens. */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  const isCurrent = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <nav aria-label="Seções do admin" className="min-w-0">
      <ul className="relative m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1 nav:flex-col nav:overflow-visible nav:pb-0">
        {items.map((item) => {
          const current = isCurrent(item.href);
          return (
            <li key={item.href} className="flex-none">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-10 items-center justify-between gap-3 rounded-[2px] px-3 font-mono text-[12px] tracking-[0.08em] whitespace-nowrap uppercase ${
                  current ? "bg-hover-2 text-text" : "text-text-3 hover:bg-hover hover:text-text"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`size-1.5 flex-none rounded-[1px] ${current ? "bg-acc" : "bg-transparent"}`}
                  />
                  {item.label}
                </span>
                {item.count ? (
                  <span className="rounded-[2px] bg-acc px-1.5 py-px text-xs font-bold text-bg tabular-nums">
                    <span className="sr-only">: </span>
                    {item.count}
                    <span className="sr-only"> pendentes</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
