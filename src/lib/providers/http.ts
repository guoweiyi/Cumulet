import { Agent, fetch as ufetch } from "undici";
import { ProviderError } from "./errors";

export type HttpProviderOptions = {
  baseUrl: string;
  tlsVerify?: boolean;
  headers?: Record<string, string>;
};

export class ProviderHttpClient {
  private readonly baseUrl: string;
  private readonly dispatcher?: Agent;
  constructor(private readonly options: HttpProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    if (options.tlsVerify === false) this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }

  async request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    let response;
    try {
      response = await ufetch(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
        method,
        headers: { Accept: "application/json", ...this.options.headers, ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      });
    } catch (error) {
      throw new ProviderError("provider_unreachable", error instanceof Error ? error.message : "Provider unreachable", error);
    }
    const text = await response.text();
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403 ? "provider_permission_denied" : `provider_http_${response.status}`;
      throw new ProviderError(code, text.slice(0, 500) || response.statusText);
    }
    if (!text) return undefined as T;
    try { return JSON.parse(text) as T; } catch { return text as T; }
  }
}
