import { NextRequest, NextResponse } from "next/server";

/** Typed API error thrown by guards and handlers; converted to a JSON response. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const unauthorized = () => new ApiError(401, "unauthorized");
export const forbidden = () => new ApiError(403, "forbidden");
export const notFound = () => new ApiError(404, "not_found");
export const badRequest = (msg?: string) => new ApiError(400, "bad_request", msg);
export const tooMany = (msg?: string) => new ApiError(429, "rate_limited", msg);

type Handler<C> = (req: NextRequest, ctx: C) => Promise<NextResponse | Response>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Route-handler wrapper: CSRF origin check on mutations + normalized error
 * responses. All API routes must go through this.
 */
export function api<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      if (MUTATING.has(req.method)) {
        // Same-origin enforcement. Modern browsers send Sec-Fetch-Site on every
        // request and Origin on all cross-site + same-origin POSTs. We require
        // at least one trustworthy signal and that it be same-origin; a request
        // presenting neither header is rejected (fail closed), backed by the
        // SameSite=Lax session cookie.
        const origin = req.headers.get("origin");
        const secFetchSite = req.headers.get("sec-fetch-site");
        const expected = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000").origin;

        let verified = false;
        if (secFetchSite) {
          if (!["same-origin", "none"].includes(secFetchSite)) {
            throw new ApiError(403, "csrf_rejected");
          }
          verified = true;
        }
        if (origin) {
          let reqOrigin: string;
          try {
            reqOrigin = new URL(origin).origin;
          } catch {
            throw new ApiError(403, "csrf_rejected");
          }
          if (reqOrigin !== expected) {
            throw new ApiError(403, "csrf_rejected");
          }
          verified = true;
        }
        if (!verified) throw new ApiError(403, "csrf_rejected");
      }
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status },
        );
      }
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}:`, err);
      return NextResponse.json(
        { error: { code: "internal_error", message: "Internal server error" } },
        { status: 500 },
      );
    }
  };
}

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(
    data,
    typeof init === "number" ? { status: init } : init,
  );
}
