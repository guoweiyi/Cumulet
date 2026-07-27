"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Cloud,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import { UserMenu } from "./user-menu";

const NAV = [
  { href: "/", key: "dashboard", icon: LayoutDashboard, exact: true },
  { href: "/servers", key: "servers", icon: Server },
  { href: "/tickets", key: "tickets", icon: Ticket },
] as const;

export function PortalShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string; email: string; isAdmin: boolean };
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Slim top nav */}
      <header className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-border bg-card px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Cloud className="size-5 text-brand" strokeWidth={2} />
          {tc("appName")}
        </Link>
        <div className="flex-1" />
        <LanguageSwitcher />
        <UserMenu {...user} />
      </header>

      <div className="flex flex-1">
        {/* Collapsible sidebar */}
        <aside
          className={cn(
            "sticky top-12 h-[calc(100vh-3rem)] shrink-0 border-r border-border bg-card transition-all",
            collapsed ? "w-12" : "w-52",
          )}
        >
          <nav className="flex h-full flex-col gap-1 p-2">
            {NAV.map(({ href, key, icon: Icon, ...rest }) => {
              const active =
                "exact" in rest && rest.exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-brand-soft font-medium text-brand-strong"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" strokeWidth={active ? 2.25 : 1.75} />
                  {!collapsed && t(key)}
                </Link>
              );
            })}
            {user.isAdmin && (
              <Link
                href="/admin"
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ShieldCheck className="size-4 shrink-0" strokeWidth={1.75} />
                {!collapsed && t("adminConsole")}
              </Link>
            )}
            <div className="flex-1" />
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground/60 transition-colors hover:bg-secondary"
            >
              {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
