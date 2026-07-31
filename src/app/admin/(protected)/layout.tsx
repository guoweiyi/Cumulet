import { redirect } from "next/navigation";
import { currentUser, isAdminRole } from "@/lib/guards";
import { AdminShell } from "@/components/admin-shell";
import { getBranding } from "@/lib/settings";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (!isAdminRole(user.role)) redirect("/");
  const branding = await getBranding();
  return (
    <AdminShell user={{ name: user.nickname ?? user.email, email: user.email, role: user.role }} branding={branding}>
      {children}
    </AdminShell>
  );
}
