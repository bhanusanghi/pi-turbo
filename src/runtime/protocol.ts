import { isDeepStrictEqual } from "node:util";
import type { ClassifierContext, ClassifierResult, JsonObject, JsonValue, Usage } from "@earendil-works/pi-ai";
import type { HelperToolGrant } from "../contracts.js";
export const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
export function addUsage(a: Usage, b?: Usage): Usage {
  if (!b) return a;
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite, totalTokens: a.totalTokens + b.totalTokens,
    cost: { input: a.cost.input + b.cost.input, output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead, cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total } };
}
export function json(value: unknown): JsonValue {
  const encoded = JSON.stringify(value ?? null);
  if (encoded === undefined) throw new Error("Expected JSON data");
  return JSON.parse(encoded) as JsonValue;
}
export function object(value: unknown): asserts value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  const visit = (v: unknown): void => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      Object.values(v).forEach(visit); return;
    }
    throw new Error("Only plain JSON values are supported");
  };
  JSON.stringify(value); // detect cycles
  visit(value);
}
export const same = (a: unknown, b: unknown): boolean => isDeepStrictEqual(a, b);
/** Preserve the validated binding through later mutable Pi hooks. */
export function freezeArguments(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freezeArguments);
  Object.freeze(value);
}
export function permitted(grants: readonly HelperToolGrant[], name: string, args: unknown): boolean {
  const grant = grants.find(g => g.name === name);
  return !!grant && (grant.allowAnyArguments === true || grant.arguments.some(a => same(a, args)));
}
export function positive(value: number | undefined, fallback: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}
export function validateAnswers(request: ClassifierContext, result: ClassifierResult): void {
  if (result.stopReason !== "stop") throw new Error(result.errorMessage ?? `Classifier ${result.stopReason}`);
  const probability = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  for (const [id, q] of Object.entries(request.questions)) {
    const a = result.answers[id];
    if (!a || a.type !== q.type) throw new Error(`Missing or mismatched classifier answer: ${id}`);
    if (a.type === "choice" && q.type === "choice") {
      if (!Object.hasOwn(q.criteria, a.choice) || !probability(a.confidence)
        || Object.keys(q.criteria).some(k => !probability(a.probabilities[k]))) throw new Error(`Invalid classifier choice: ${id}`);
    } else if (a.type === "bool" && !probability(a.probability)) throw new Error(`Invalid Boolean answer: ${id}`);
    else if (a.type === "score" && (!Number.isFinite(a.score) || !probability(a.confidence))) throw new Error(`Invalid score: ${id}`);
  }
}
