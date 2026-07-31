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
const SHARED_ASSET_ROOT = "/DEFAULT/共享区";

type JumpServerNode = {
  id: string;
  value: string;
  full_value: string;
};

function listResults<T>(value: T[] | { results?: T[] }): T[] {
  return Array.isArray(value) ? value : (value.results ?? []);
}

function userNodeName(value: string): string {
  return value
    .trim()
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

export function jumpServerUserAssetPath(displayName: string): string {
  return `${SHARED_ASSET_ROOT}/${userNodeName(displayName)}`;
}

export function jumpServerLunaUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/luna/`;
}

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
      const now = gmtDate();
      const accept = "application/json";
      const signingString = `(request-target): ${method.toLowerCase()} ${path}\naccept: ${accept}\ndate: ${now}`;
      const signature = createHmac("sha256", this.cfg.accessKeySecret)
        .update(signingString)
        .digest("base64");
      const auth = `Signature keyId="${this.cfg.accessKeyId}",algorithm="hmac-sha256",headers="(request-target) accept date",signature="${signature}"`;
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
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

  private async findNodeByPath(path: string): Promise<JumpServerNode | null> {
    const leaf = path.split("/").filter(Boolean).at(-1) ?? "";
    const response = await this.request<JumpServerNode[] | { results?: JumpServerNode[] }>(
      "GET",
      `/api/v1/assets/nodes/?search=${encodeURIComponent(leaf)}&limit=100`,
    );
    return listResults(response).find((node) => node.full_value === path) ?? null;
  }

  /** Ensure the fixed shared-area child used to group one user's assets. */
  async ensureUserAssetNode(displayName: string): Promise<{ id: string; path: string }> {
    const nodeName = userNodeName(displayName);
    if (!nodeName) throw new JumpServerError(400, "JumpServer user asset node name is empty");
    const path = jumpServerUserAssetPath(displayName);
    const existing = await this.findNodeByPath(path);
    if (existing) return { id: existing.id, path };

    const root = await this.findNodeByPath(SHARED_ASSET_ROOT);
    if (!root) throw new JumpServerError(404, `JumpServer asset root ${SHARED_ASSET_ROOT} not found`);

    try {
      const created = await this.request<JumpServerNode>("POST", "/api/v1/assets/nodes/", {
        value: nodeName,
        full_value: path,
      });
      return { id: created.id, path };
    } catch (error) {
      if (!(error instanceof JumpServerError) || ![400, 409].includes(error.status)) throw error;
      const raced = await this.findNodeByPath(path);
      if (!raced) throw error;
      return { id: raced.id, path };
    }
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

  async setHostNode(id: string, nodeId: string): Promise<void> {
    await this.request("PATCH", `/api/v1/assets/hosts/${id}/`, { nodes: [nodeId] });
  }

  async deleteHost(id: string): Promise<void> {
    await this.request("DELETE", `/api/v1/assets/hosts/${id}/`);
  }

  /** Idempotent lookup of a managed credential account on an asset. */
  async findAccount(assetId: string, username: string): Promise<{ id: string } | null> {
    const accounts = await this.request<
      { results?: { id: string; username: string }[] } | { id: string; username: string }[]
    >(
      "GET",
      `/api/v1/accounts/accounts/?asset=${encodeURIComponent(assetId)}&username=${encodeURIComponent(username)}`,
    );
    const list = Array.isArray(accounts) ? accounts : (accounts.results ?? []);
    const match = list.find((account) => account.username === username);
    return match ? { id: match.id } : null;
  }

  /**
   * Create a managed account bound to an existing asset. The secret is
   * write-only from the client's perspective; JumpServer encrypts it at rest.
   */
  async createAccount(opts: {
    assetId: string;
    username: string;
    secret: string;
  }): Promise<{ id: string }> {
    const account = await this.request<{ id: string }>("POST", "/api/v1/accounts/accounts/", {
      asset: opts.assetId,
      username: opts.username,
      secret_type: "password",
      secret: opts.secret,
      is_active: true,
    });
    return { id: account.id };
  }

  /** Keep an existing account's secret in sync (idempotent re-run). */
  async updateAccountSecret(id: string, secret: string): Promise<void> {
    await this.request("PATCH", `/api/v1/accounts/accounts/${id}/`, { secret });
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
