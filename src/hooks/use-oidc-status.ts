"use client";

import { useEffect, useState } from "react";

export function useOidcStatus() {
  const [status, setStatus] = useState<{ enabled: boolean; providerName: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/oidc", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { enabled: false, providerName: "SSO" })
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, providerName: "SSO" }));
  }, []);
  return status;
}
