import { Suspense } from "react";
import { getBranding } from "@/lib/settings";
import { LoginInner } from "@/components/login-inner";

export default async function LoginPage() {
  const branding = await getBranding();
  return (
    <Suspense>
      <LoginInner branding={branding} />
    </Suspense>
  );
}
