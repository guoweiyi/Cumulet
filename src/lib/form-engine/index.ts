/**
 * Dynamic form engine — the single source of truth shared by the admin
 * builder, the client renderer, and the server-side submission validator.
 * All consumers import from here.
 */
export * from "./types";
export { formDefinitionSchema, fieldSchema, conditionSchema, parseDefinition } from "./schema";
export { validateDefinition, asDefinition } from "./definition";
export type { DefinitionResult, DefinitionError } from "./definition";
export { evaluateVisibility, referencedFields } from "./visibility";
export { validateSubmission } from "./validate";
export type { SubmissionResult } from "./validate";
export { defaultValues } from "./defaults";
export { pick } from "./locale";
