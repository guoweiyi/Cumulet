import { redirect } from "next/navigation";
import { currentUser, isAdminRole } from "@/lib/guards";
import { AdminShell } from "@/components/admin-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/admin/login");
  if (!isAdminRole(user.role)) redirect("/");
  return (
    <AdminShell user={{ name: user.nickname ?? user.email, email: user.email, role: user.role }}>
      {children}
    </AdminShell>
  );
}
