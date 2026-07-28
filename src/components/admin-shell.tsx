"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Cloud,
  BrainCircuit,
  FileEdit,
  Gauge,
  KeyRound,
  Network,
  ScrollText,
  Server,
  Settings,
  SlidersHorizontal,
  Shield,
  Blocks,
  Ticket,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import { UserMenu } from "./user-menu";
import { Badge } from "@/components/ui/badge";

const NAV = [
  { href: "/admin", key: "overview", icon: Gauge, exact: true },
  { href: "/admin/tickets", key: "tickets", icon: Ticket },
  { href: "/admin/forms", key: "forms", icon: FileEdit, writeOnly: false },
  { href: "/admin/resources", key: "resources", icon: Server },
  { href: "/admin/resize-requests", key: "resizeRequests", icon: SlidersHorizontal },
  { href: "/admin/ai-inspections", key: "aiInspections", icon: BrainCircuit },
  { href: "/admin/nodes", key: "nodes", icon: Network },
  { href: "/admin/security-groups", key: "securityGroups", icon: Shield },
  { href: "/admin/platform", key: "platform", icon: Blocks },
  { href: "/admin/users", key: "users", icon: Users, superOnly: false },
  { href: "/admin/settings", key: "settings", icon: Settings, superOnly: true },
  { href: "/admin/audit", key: "audit", icon: ScrollText },
  { href: "/admin/profile", key: "profile", icon: KeyRound },
] as const;

export function AdminShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string; email: string; role: string };
}) {
  const t = useTranslations("admin.nav");
  const tc = useTranslations("common");
  const tr = useTranslations("admin.user.roles");
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b bg-neutral-900 px-4 text-white">
        <Link href="/admin" className="flex items-center gap-2 text-sm font-semibold">
          <Cloud className="size-5 text-blue-400" />
          {tc("appName")}
          <Badge variant="secondary" className="bg-neutral-700 text-neutral-200">
            Admin
          </Badge>
        </Link>
        <div className="flex-1" />
        <span className="text-xs text-neutral-400">{tr(user.role as never)}</span>
        <LanguageSwitcher />
        <UserMenu name={user.name} email={user.email} isAdmin={false} loginPath="/admin/login" />
      </header>

      <div className="flex flex-1">
        <aside className="sticky top-12 h-[calc(100vh-3rem)] w-52 shrink-0 border-r border-border bg-card">
          <nav className="flex flex-col gap-0.5 p-2">
            {NAV.filter((n) => !("superOnly" in n && n.superOnly) || user.role === "SUPER_ADMIN").map(
              ({ href, key, icon: Icon, ...rest }) => {
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
                    {t(key)}
                  </Link>
                );
              },
            )}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
