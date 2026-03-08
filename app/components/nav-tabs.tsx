"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "每日精选" },
  { href: "/analyze", label: "URL 分析" },
] as const;

export default function NavTabs(): React.ReactNode {
  const pathname = usePathname();

  return (
    <nav className="nav-tabs">
      {TABS.map((tab) => {
        const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`nav-tab${active ? " is-active" : ""}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
