import { redirect } from "next/navigation";
import { currentUser } from "@/lib/guards";
import { PortalShell } from "@/components/portal-shell";
import { isAdminRole } from "@/lib/guards";
import { getBranding } from "@/lib/settings";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const branding = await getBranding();
  return (
    <PortalShell
      user={{
        name: user.nickname ?? user.email,
        email: user.email,
        isAdmin: isAdminRole(user.role),
      }}
      branding={branding}
    >
      {children}
    </PortalShell>
  );
}
