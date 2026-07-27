"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function UserMenu({
  name,
  email,
  isAdmin,
  loginPath = "/login",
}: {
  name: string;
  email: string;
  isAdmin: boolean;
  loginPath?: string;
}) {
  const t = useTranslations("nav");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none">
        <Avatar className="size-8 border">
          <AvatarFallback className="text-xs bg-blue-600 text-white">
            {(name || email).slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-neutral-500 font-normal">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheck className="size-4" /> {t("adminConsole")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: loginPath })}>
          <LogOut className="size-4" /> {t("logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
