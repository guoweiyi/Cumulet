import "server-only";
import document from "@/generated/openapi.json";

export function getOpenApiDocument() {
  return document;
}
