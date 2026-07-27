import "server-only";
import { createHmac } from "crypto";
import { fetch as ufetch } from "undici";
import { getSetting, type JumpServerSettings } from "./settings";
import { audit } from "./audit";
import { ApiError } from "./api";

/**
 * JumpServer v3/v4 REST client. All version-specific details are isolated
 * here. Server-side only. Base URL comes exclusively from admin settings
 * (never user input) — no SSRF surface.
 *
 * Auth modes:
 *  - private_token: `Authorization: Token <token>`
 *  - access_key:    HTTP-Signature over (request-target), accept, date with
 *                   HMAC-SHA256(AccessKeySecret).
 * Every request carries the X-JMS-ORG organization header.
 */

export class JumpServerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

export class JumpServerClient {
  private base: string;

  constructor(
    private cfg: JumpServerSettings,
    private actorId?: string | null,
  ) {
    this.base = cfg.baseUrl.replace(/\/$/, "");
  }

  private authHeaders(method: string, path: string): Record<string, string> {
    const org = this.cfg.orgId || "00000000-0000-0000-0000-000000000002";
    if (this.cfg.authMode === "access_key") {
      // GMT date, RFC1123; signature over the three headers JumpServer expects.
      const date = new Date(Date.UTC(2020, 0, 1)).toUTCString(); // replaced below
      const now = gmtDate();
      const accept = "application/json";
      const signingString = `(request-target): ${method.toLowerCase()} ${path}\naccept: ${accept}\ndate: ${now}`;
      const signature = createHmac("sha256", this.cfg.accessKeySecret)
        .update(signingString)
        .digest("base64");
      const auth = `Signature keyId="${this.cfg.accessKeyId}",algorithm="hmac-sha256",headers="(request-target) accept date",signature="${signature}"`;
      void date;
      return {
        Authorization: auth,
        Accept: accept,
        Date: now,
        "X-JMS-ORG": org,
      };
    }
    return {
      Authorization: `Token ${this.cfg.privateToken}`,
      Accept: "application/json",
      "X-JMS-ORG": org,
    };
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.base}${path}`;
    let res;
    try {
      res = await ufetch(url, {
        method,
        headers: {
          ...this.authHeaders(method, path),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new JumpServerError(0, `JumpServer unreachable: ${err instanceof Error ? err.message : "network"}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.detail ?? parsed.msg ?? JSON.stringify(parsed).slice(0, 300);
      } catch {
        if (text) detail = text.slice(0, 300);
      }
      throw new JumpServerError(res.status, `JumpServer ${res.status}: ${detail}`);
    }
    if (method !== "GET") {
      await audit({
        actorId: this.actorId ?? null,
        action: `jumpserver.${method.toLowerCase()}`,
        targetType: "JumpServer",
        targetId: path,
      });
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /** Test connection: current authenticated identity / org profile. */
  async testConnection(): Promise<{ ok: boolean }> {
    await this.request("GET", "/api/v1/users/profile/");
    return { ok: true };
  }

  async findUserByEmail(email: string): Promise<{ id: string; name: string } | null> {
    const users = await this.request<{ id: string; name: string; email: string }[]>(
      "GET",
      `/api/v1/users/users/?email=${encodeURIComponent(email)}`,
    );
    const match = Array.isArray(users) ? users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) : null;
    return match ? { id: match.id, name: match.name } : null;
  }

  async createUser(email: string, name: string): Promise<{ id: string }> {
    const user = await this.request<{ id: string }>("POST", "/api/v1/users/users/", {
      name,
      username: email,
      email,
      source: "local",
      is_active: true,
    });
    return { id: user.id };
  }

  async findHostByAddress(address: string): Promise<{ id: string } | null> {
    const hosts = await this.request<{ results?: { id: string; address: string }[] } | { id: string; address: string }[]>(
      "GET",
      `/api/v1/assets/hosts/?address=${encodeURIComponent(address)}`,
    );
    const list = Array.isArray(hosts) ? hosts : (hosts.results ?? []);
    const match = list.find((h) => h.address === address);
    return match ? { id: match.id } : null;
  }

  async createHost(opts: {
    name: string;
    address: string;
    nodeId: string;
    accountTemplate?: string;
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: opts.name,
      address: opts.address,
      platform: { pk: 1 }, // Linux platform id 1 in stock JumpServer
      protocols: [{ name: "ssh", port: 22 }],
    };
    if (opts.nodeId) body.nodes = [opts.nodeId];
    if (opts.accountTemplate) body.accounts = [{ template: opts.accountTemplate }];
    const host = await this.request<{ id: string }>("POST", "/api/v1/assets/hosts/", body);
    return { id: host.id };
  }

  async deleteHost(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/assets/hosts/${id}/`);
  }

  async createAssetPermission(opts: {
    name: string;
    userId: string;
    assetId: string;
    accountUsername: string;
    expiresAt?: string;
  }): Promise<{ id: string }> {
    const body: Record<string, unknown> = {
      name: opts.name,
      users: [opts.userId],
      assets: [opts.assetId],
      accounts: [opts.accountUsername || "@ALL"],
      actions: ["connect"],
      is_active: true,
    };
    if (opts.expiresAt) body.date_expired = opts.expiresAt;
    const perm = await this.request<{ id: string }>("POST", "/api/v1/perms/asset-permissions/", body);
    return { id: perm.id };
  }

  async deleteAssetPermission(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/perms/asset-permissions/${id}/`);
  }
}

function gmtDate(): string {
  // Date.now() is fine on the server (only workflow scripts forbid it).
  return new Date().toUTCString();
}

/** Build a client from stored settings; throws 409 if unconfigured. */
export async function jumpServerClient(actorId?: string | null): Promise<JumpServerClient> {
  const cfg = await getSetting("jumpserver");
  if (!cfg?.baseUrl) throw new ApiError(409, "jumpserver_not_configured");
  const hasAuth =
    cfg.authMode === "access_key"
      ? cfg.accessKeyId && cfg.accessKeySecret
      : Boolean(cfg.privateToken);
  if (!hasAuth) throw new ApiError(409, "jumpserver_not_configured");
  return new JumpServerClient(cfg, actorId);
}
