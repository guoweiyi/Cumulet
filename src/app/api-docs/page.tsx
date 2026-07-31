import "swagger-ui-react/swagger-ui.css";
import { redirect } from "next/navigation";
import { getOpenApiDocument } from "@/lib/openapi";
import { currentUser, isAdminRole } from "@/lib/guards";
import SwaggerDocs from "./swagger";

export const dynamic = "force-dynamic";

/**
 * API reference is admin-only: the generated spec documents admin, VNC and
 * internal scheduler endpoints, so it must not be reachable anonymously.
 */
export default async function ApiDocsPage() {
  const user = await currentUser();
  if (!user || !isAdminRole(user.role)) redirect("/admin/login");
  const spec = getOpenApiDocument() as Record<string, unknown>;
  return (
    <main className="min-h-screen bg-white">
      <SwaggerDocs spec={spec} />
    </main>
  );
}
