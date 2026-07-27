import { redirect } from "next/navigation";
import { currentUser } from "@/lib/guards";
import { PortalShell } from "@/components/portal-shell";
import { isAdminRole } from "@/lib/guards";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <PortalShell
      user={{
        name: user.nickname ?? user.email,
        email: user.email,
        isAdmin: isAdminRole(user.role),
      }}
    >
      {children}
    </PortalShell>
  );
}
