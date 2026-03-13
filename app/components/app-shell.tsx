"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { fetchAuthUser } from "@/lib/client/auth";
import type { AuthUser } from "@/lib/client/types";

const NAV_ITEMS = [
  { href: "/", icon: "📰", label: "每日精选" },
  { href: "/hearts", icon: "❤️", label: "我的收藏" },
  { href: "/parser", icon: "🔗", label: "万能解析" },
  { href: "/docs", icon: "📖", label: "CLI 文档" },
  { href: "/settings", icon: "⚙️", label: "设置" },
] as const;

function SidebarLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}): React.ReactNode {
  return (
    <Link href={href} className={`sidebar-link${active ? " is-active" : ""}`}>
      <span className="sidebar-link-icon">{icon}</span>
      {label}
    </Link>
  );
}

function TabBarItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}): React.ReactNode {
  return (
    <Link href={href} className={`tabbar-item${active ? " is-active" : ""}`}>
      <span className="tabbar-item-icon">{icon}</span>
      {label}
    </Link>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }): React.ReactNode {
  const pathname = usePathname();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const { user } = await fetchAuthUser();
      setAuthUser(user);
      setAuthLoaded(true);
    })();
  }, []);

  function isActive(href: string): boolean {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <div className="app-shell">
      {/* Desktop Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">AI News</div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <SidebarLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={isActive(item.href)}
            />
          ))}
        </nav>
        <div className="sidebar-footer">
          {authLoaded ? (
            authUser ? (
              <Link href="/settings" className="sidebar-user-chip">
                {authUser.email}
              </Link>
            ) : (
              <button
                type="button"
                className="sidebar-login-btn"
                onClick={() => window.location.assign("/api/auth/login")}
              >
                登录
              </button>
            )
          ) : null}
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="mobile-header">
        <span className="mobile-brand">AI News</span>
        <div className="mobile-auth">
          {authLoaded && authUser ? (
            <Link href="/settings" className="mobile-user-chip">
              {authUser.email}
            </Link>
          ) : authLoaded ? (
            <button
              type="button"
              className="sidebar-login-btn"
              onClick={() => window.location.assign("/api/auth/login")}
            >
              登录
            </button>
          ) : null}
        </div>
      </header>

      {/* Main Content */}
      <main className="app-content">{children}</main>

      {/* Mobile Tab Bar */}
      <nav className="mobile-tabbar">
        {NAV_ITEMS.map((item) => (
          <TabBarItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={isActive(item.href)}
          />
        ))}
      </nav>
    </div>
  );
}
