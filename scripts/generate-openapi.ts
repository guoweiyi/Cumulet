import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSwaggerSpec } from "next-swagger-doc";
import { openApiDefinition } from "../src/lib/openapi-definition";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "src/generated/openapi.json");
const spec = createSwaggerSpec({
  apiFolder: "src/app/api",
  definition: openApiDefinition,
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
const documented = spec as { paths?: Record<string, unknown> };
console.log(`[openapi] generated ${Object.keys(documented.paths ?? {}).length} documented paths`);
