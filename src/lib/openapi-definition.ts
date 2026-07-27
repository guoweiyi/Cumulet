export const openApiDefinition = {
  openapi: "3.0.3",
  info: {
    title: "Cumulet REST API",
    version: "0.2.0",
    description: "API-first cloud resource management for tickets, providers, networking, quotas, leases, and webhooks.",
    license: { name: "Open Source" },
  },
  servers: [{ url: "/", description: "Current Cumulet instance" }],
  tags: [
    { name: "Tenants" },
    { name: "Networks" },
    { name: "Providers" },
    { name: "External Access" },
    { name: "DNS" },
    { name: "Webhooks" },
    { name: "Resources" },
    { name: "Virtual Machines" },
    { name: "Lifecycle" },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
        description: "Auth.js session cookie. Production deployments may use the __Secure- prefix.",
      },
      bearerCronToken: {
        type: "http",
        scheme: "bearer",
        description: "INTERNAL_CRON_TOKEN for the private lifecycle scheduler endpoint.",
      },
    },
    parameters: {
      Id: { name: "id", in: "path", required: true, schema: { type: "string" } },
      UserId: { name: "userId", in: "path", required: true, schema: { type: "string" } },
      AttachmentId: { name: "attachmentId", in: "path", required: true, schema: { type: "string" } },
      SubnetId: { name: "subnetId", in: "path", required: true, schema: { type: "string" } },
    },
    schemas: {
      ApiError: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" }, detail: { type: "string" } },
      },
      UserQuota: {
        type: "object",
        required: ["maxCpuCores", "maxRamGB", "maxDiskGB", "maxFirewallRules"],
        properties: {
          maxCpuCores: { type: "integer", minimum: 1 },
          maxRamGB: { type: "integer", minimum: 1 },
          maxDiskGB: { type: "integer", minimum: 1 },
          maxFirewallRules: { type: "integer", minimum: 0 },
        },
      },
      ExternalAccessMapping: {
        type: "object",
        properties: {
          id: { type: "string" },
          resourceId: { type: "string" },
          protocol: { type: "string", enum: ["TCP", "HTTP", "HTTPS"] },
          internalHost: { type: "string" },
          internalPort: { type: "integer" },
          externalPort: { type: "integer", nullable: true },
          hostname: { type: "string", nullable: true },
          status: { type: "string", enum: ["PENDING", "ACTIVE", "FAILED", "DISABLED"] },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    "/api/admin/providers": {
      get: { tags: ["Providers"], summary: "List provider instances", responses: { "200": { description: "Provider collection" } } },
      post: { tags: ["Providers"], summary: "Create a provider instance", responses: { "201": { description: "Provider created" } } },
    },
    "/api/admin/providers/{id}": {
      patch: { tags: ["Providers"], summary: "Update a provider instance", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Provider updated" } } },
      delete: { tags: ["Providers"], summary: "Delete an unused provider instance", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Provider deleted" } } },
    },
    "/api/admin/tenants": {
      get: { tags: ["Tenants"], summary: "List tenants", responses: { "200": { description: "Tenant collection" } } },
      post: { tags: ["Tenants"], summary: "Create a tenant", responses: { "201": { description: "Tenant created" } } },
    },
    "/api/admin/tenants/{id}": {
      patch: { tags: ["Tenants"], summary: "Update a tenant", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Tenant updated" } } },
      delete: { tags: ["Tenants"], summary: "Delete an empty tenant", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Tenant deleted" } } },
    },
    "/api/admin/tenants/{id}/members": {
      get: { tags: ["Tenants"], summary: "List tenant members", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Membership collection" } } },
      post: { tags: ["Tenants"], summary: "Add a tenant member", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "201": { description: "Member added" } } },
    },
    "/api/admin/tenants/{id}/members/{userId}": {
      delete: { tags: ["Tenants"], summary: "Remove a tenant member", parameters: [{ $ref: "#/components/parameters/Id" }, { $ref: "#/components/parameters/UserId" }], responses: { "200": { description: "Member removed" } } },
    },
    "/api/admin/networks": {
      get: { tags: ["Networks"], summary: "List tenant networks and subnets", responses: { "200": { description: "Network collection" } } },
      post: { tags: ["Networks"], summary: "Create an isolated network", responses: { "201": { description: "Network created" } } },
    },
    "/api/admin/networks/{id}": {
      patch: { tags: ["Networks"], summary: "Update an isolated network", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Network updated" } } },
      delete: { tags: ["Networks"], summary: "Delete an unused network", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Network deleted" } } },
    },
    "/api/admin/networks/{id}/subnets": {
      post: { tags: ["Networks"], summary: "Create a subnet", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "201": { description: "Subnet created" } } },
    },
    "/api/admin/networks/{id}/subnets/{subnetId}": {
      delete: { tags: ["Networks"], summary: "Delete an unused subnet", parameters: [{ $ref: "#/components/parameters/Id" }, { $ref: "#/components/parameters/SubnetId" }], responses: { "200": { description: "Subnet deleted" } } },
    },
    "/api/admin/resources/{id}/network-attachments": {
      post: { tags: ["Networks"], summary: "Attach a resource to an authorized tenant subnet", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "201": { description: "Network attached" } } },
    },
    "/api/admin/resources/{id}/network-attachments/{attachmentId}": {
      delete: { tags: ["Networks"], summary: "Detach a resource network", parameters: [{ $ref: "#/components/parameters/Id" }, { $ref: "#/components/parameters/AttachmentId" }], responses: { "200": { description: "Network detached" } } },
    },
    "/api/admin/reverse-proxy-gateways": {
      get: { tags: ["External Access"], summary: "List reverse proxy gateways", responses: { "200": { description: "Gateway collection" } } },
      post: { tags: ["External Access"], summary: "Create a reverse proxy gateway", responses: { "201": { description: "Gateway created" } } },
    },
    "/api/admin/reverse-proxy-gateways/{id}": {
      patch: { tags: ["External Access"], summary: "Update a reverse proxy gateway", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Gateway updated" } } },
      delete: { tags: ["External Access"], summary: "Delete an unused reverse proxy gateway", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Gateway deleted" } } },
    },
    "/api/admin/external-access": {
      get: { tags: ["External Access"], summary: "List FRP and split DNS mappings", responses: { "200": { description: "Mapping collection" } } },
      post: { tags: ["External Access"], summary: "Create and reconcile an external access mapping", responses: { "201": { description: "Mapping applied" } } },
    },
    "/api/admin/external-access/{id}/reconcile": {
      post: { tags: ["External Access"], summary: "Retry an external access mapping", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Mapping reconciled" } } },
    },
    "/api/admin/external-access/{id}": {
      delete: { tags: ["External Access"], summary: "Delete an external access mapping", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Mapping deleted" } } },
    },
    "/api/admin/external-access/{id}/export": {
      get: { tags: ["External Access"], summary: "Export an FRPC configuration", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "FRPC configuration" } } },
    },
    "/api/admin/dns-zones": {
      get: { tags: ["DNS"], summary: "List split DNS zones", responses: { "200": { description: "DNS zone collection" } } },
      post: { tags: ["DNS"], summary: "Create a split DNS zone", responses: { "201": { description: "DNS zone created" } } },
    },
    "/api/admin/dns-zones/{id}": {
      patch: { tags: ["DNS"], summary: "Update DNS synchronization settings", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "DNS zone updated" } } },
      delete: { tags: ["DNS"], summary: "Delete an empty DNS zone", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "DNS zone deleted" } } },
    },
    "/api/admin/dns-zones/{id}/reconcile": {
      post: { tags: ["DNS"], summary: "Reconcile all records in a DNS zone", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Per-record results" } } },
    },
    "/api/admin/dns-zones/{id}/export": {
      get: { tags: ["DNS"], summary: "Export deterministic split DNS configuration", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Plain-text split DNS configuration" } } },
    },
    "/api/admin/webhooks": {
      get: { tags: ["Webhooks"], summary: "List webhook subscriptions", responses: { "200": { description: "Webhook collection" } } },
      post: { tags: ["Webhooks"], summary: "Create a signed webhook subscription", responses: { "201": { description: "Webhook created" } } },
    },
    "/api/admin/webhooks/{id}": {
      patch: { tags: ["Webhooks"], summary: "Update a webhook subscription", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Webhook updated" } } },
      delete: { tags: ["Webhooks"], summary: "Delete a webhook subscription", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Webhook deleted" } } },
    },
    "/api/admin/resources/{id}/lease": {
      patch: { tags: ["Resources"], summary: "Renew or change a resource lease", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Lease updated" } } },
    },
    "/api/admin/tickets/{id}/approve": {
      post: { tags: ["Resources"], summary: "Approve a ticket after quota validation and start provisioning", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Provisioning started" }, "422": { description: "Quota or capacity validation failed" } } },
    },
    "/api/vms/{id}/power": {
      post: { tags: ["Virtual Machines"], summary: "Perform an authorized power action", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Provider task accepted" } } },
    },
    "/api/vms/{id}/resize": {
      post: { tags: ["Virtual Machines"], summary: "Resize within the owner quota", parameters: [{ $ref: "#/components/parameters/Id" }], responses: { "200": { description: "Resize accepted" }, "422": { description: "Quota exceeded" } } },
    },
    "/api/internal/lifecycle/cron": {
      post: { tags: ["Lifecycle"], summary: "Run lease expiry and durable webhook jobs", security: [{ bearerCronToken: [] }], responses: { "200": { description: "Job summary" }, "401": { description: "Invalid cron token" } } },
    },
  },
};
