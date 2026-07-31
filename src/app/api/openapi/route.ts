import { NextResponse } from "next/server";
import { currentUser, isAdminRole } from "@/lib/guards";
import { getOpenApiDocument } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export async function GET() {
  // The spec exposes admin/internal endpoints; require an admin session.
  const user = await currentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json(
      { error: { code: "forbidden" } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(getOpenApiDocument(), {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
