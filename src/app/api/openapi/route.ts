import { NextResponse } from "next/server";
import { getOpenApiDocument } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getOpenApiDocument(), {
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

