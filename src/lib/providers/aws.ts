import "server-only";
import { createHash, createHmac } from "node:crypto";
import type { ProviderInstance } from "@prisma/client";
import { fetch as ufetch } from "undici";
import { decryptSecret } from "@/lib/crypto";
import { ProviderError } from "./errors";
import type { IHypervisorProvider, ProviderResourceRef, ProviderResourceStatus, ProviderTask, ProvisionInput, ProvisionResult, ResizeInput } from "./types";

type AwsConfig = { region?: string; endpoint?: string };
type AwsSecret = { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string };

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value).digest();
const xmlValue = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"))?.[1];

export class AwsProvider implements IHypervisorProvider {
  readonly type = "AWS" as const;
  private readonly region: string;
  private readonly endpoint: URL;
  private readonly secret: AwsSecret;

  constructor(readonly instanceId: string, instance: ProviderInstance) {
    const config = instance.config as AwsConfig;
    this.region = config.region || "";
    if (!this.region) throw new ProviderError("provider_misconfigured", "AWS region is required");
    this.endpoint = new URL(config.endpoint || `https://ec2.${this.region}.amazonaws.com`);
    try { this.secret = JSON.parse(instance.secretEnc ? decryptSecret(instance.secretEnc) : "{}"); } catch { throw new ProviderError("provider_misconfigured", "AWS secret must be JSON"); }
    if (!this.secret.accessKeyId || !this.secret.secretAccessKey) throw new ProviderError("provider_misconfigured", "AWS accessKeyId and secretAccessKey are required");
  }

  private async query(action: string, params: Record<string, string> = {}): Promise<string> {
    const body = new URLSearchParams({ Action: action, Version: "2016-11-15", ...params }).toString();
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded; charset=utf-8", host: this.endpoint.host, "x-amz-date": amzDate };
    if (this.secret.sessionToken) headers["x-amz-security-token"] = this.secret.sessionToken;
    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map((key) => `${key}:${headers[key].trim()}\n`).join("");
    const canonical = `POST\n${this.endpoint.pathname || "/"}\n\n${canonicalHeaders}\n${signedHeaders}\n${hash(body)}`;
    const scope = `${date}/${this.region}/ec2/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hash(canonical)}`;
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secret.secretAccessKey}`, date), this.region), "ec2"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.secret.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    let response;
    try { response = await ufetch(this.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) }); }
    catch (error) { throw new ProviderError("provider_unreachable", error instanceof Error ? error.message : "AWS unreachable", error); }
    const text = await response.text();
    if (!response.ok) {
      const message = xmlValue(text, "Message") || response.statusText;
      throw new ProviderError(response.status === 401 || response.status === 403 ? "provider_permission_denied" : `provider_http_${response.status}`, message);
    }
    return text;
  }

  async healthCheck() {
    await this.query("DescribeInstances", { "MaxResults": "5" });
    return { capabilities: ["status", "power", "instance-type-resize", "tags"] };
  }

  async getStatus(resource: ProviderResourceRef): Promise<ProviderResourceStatus> {
    const xml = await this.query("DescribeInstances", { "InstanceId.1": resource.providerResourceId });
    const state = xmlValue(xml, "name") || "unknown";
    const instanceType = xmlValue(xml, "instanceType");
    return { state: state === "running" ? "running" : state === "stopped" ? "stopped" : state === "pending" ? "paused" : "unknown", raw: { instanceType, state } };
  }

  private async action(resource: ProviderResourceRef, action: string): Promise<ProviderTask> {
    await this.query(action, { "InstanceId.1": resource.providerResourceId });
    return { accepted: true };
  }
  powerOn(resource: ProviderResourceRef) { return this.action(resource, "StartInstances"); }
  shutdown(resource: ProviderResourceRef) { return this.action(resource, "StopInstances"); }
  reboot(resource: ProviderResourceRef) { return this.action(resource, "RebootInstances"); }
  forceStop(resource: ProviderResourceRef) { return this.query("StopInstances", { "InstanceId.1": resource.providerResourceId, Force: "true" }).then(() => ({ accepted: true })); }

  async resize(input: ResizeInput): Promise<ProviderTask> {
    const instanceType = input.cpuCores <= 2 && input.ramGB <= 4 ? "t3.medium" : input.cpuCores <= 4 && input.ramGB <= 16 ? "m7i.xlarge" : `m7i.${Math.max(2, Math.ceil(input.cpuCores / 4))}xlarge`;
    await this.query("ModifyInstanceAttribute", { InstanceId: input.providerResourceId, "InstanceType.Value": instanceType });
    return { accepted: true };
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    await this.query("CreateTags", { "ResourceId.1": input.providerResourceId, "Tag.1.Key": "Name", "Tag.1.Value": input.displayName });
    await this.resize(input);
    return { providerResourceId: input.providerResourceId, requiresRestart: true };
  }
}
