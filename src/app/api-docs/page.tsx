import "swagger-ui-react/swagger-ui.css";
import { getOpenApiDocument } from "@/lib/openapi";
import SwaggerDocs from "./swagger";

export const dynamic = "force-dynamic";

export default function ApiDocsPage() {
  const spec = getOpenApiDocument() as Record<string, unknown>;
  return (
    <main className="min-h-screen bg-white">
      <SwaggerDocs spec={spec} />
    </main>
  );
}
