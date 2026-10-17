import { expect, test } from "bun:test";
import { createSourceCatalog } from "../src/sources/catalog.js";
import { SourceFailure, type ConnectionDraft, type SourceWatch } from "../src/sources/contracts.js";
import type { InputDraft } from "../src/contracts.js";
import { telegramSourceExtension } from "../src/providers/telegram/index.js";
import { xSourceExtensions } from "../src/providers/x/index.js";

const catalog = createSourceCatalog([telegramSourceExtension, ...xSourceExtensions]);
const telegram: ConnectionDraft = { label: "Reader", enabled: true, adapter: "telegram-user", apiIdRef: "TG_ID", apiHashRef: "TG_HASH", sessionName: "personal" };
const x: ConnectionDraft = { label: "Official", enabled: true, adapter: "x-api", secretRef: "X_TOKEN" };
const watch: SourceWatch = { connectionId: "connection", target: "@market_news", pollIntervalMs: 60_000 };
const revision = (time: string | null, extra: Partial<InputDraft> = {}): InputDraft => ({ sourceItemId: "chat:1", kind: "message", publishedAt: time, text: "Message", ...extra });

test("social registrations retain closed provider connection contracts", () => {
  for (const connection of [telegram, x, { ...x, adapter: "x-session" }]) expect(() => catalog.validateConnection(connection)).not.toThrow();
  for (const connection of [
    { ...telegram, secretRef: "X_TOKEN" }, { ...telegram, apiIdRef: true }, { ...telegram, apiHashRef: "file:private" },
    { ...telegram, sessionName: "../private" }, { ...telegram, sessionName: "a".repeat(65) },
    { ...x, apiIdRef: "TG_ID" }, { ...x, secretRef: 123 }, { ...x, secretRef: "token-file" }, { ...x, secretRef: "A".repeat(101) },
    { ...x, adapter: "unknown" }, { ...x, surprise: true },
  ]) expect(() => catalog.validateConnection(connection)).toThrow();
});

test("social target and mode rules come from the selected registration", () => {
  for (const target of ["@market_news", "market_news", "-1001234567890", "77"]) expect(() => catalog.validateWatch(telegram, { ...watch, target, mode: "poll" })).not.toThrow();
  for (const target of ["@abc", "https://t.me/news", "9007199254740992", "@1234"]) expect(() => catalog.validateWatch(telegram, { ...watch, target })).toThrow();
  for (const adapter of ["x-api", "x-session"]) {
    for (const target of ["@X", "77", "market_news", "9".repeat(30)]) expect(() => catalog.validateWatch({ ...x, adapter }, { ...watch, target })).not.toThrow();
    for (const target of ["-77", "https://x.com/news", "a".repeat(16), "9".repeat(31)]) expect(() => catalog.validateWatch({ ...x, adapter }, { ...watch, target })).toThrow();
    expect(() => catalog.validateWatch({ ...x, adapter }, { ...watch, mode: "push" })).toThrow();
  }
  expect(() => catalog.validateWatch(telegram, { ...watch, mode: "push" })).toThrow();
});

test("Telegram registration rejects older history and resurrection while admitting same-second edits", () => {
  const original = revision("2026-10-16T01:00:00Z");
  const edited = revision(original.publishedAt, { text: "Edited", provenance: { provider: "telegram", targetId: "chat", messageId: "1", editedAt: "2026-10-16T01:01:00Z" } });
  expect(catalog.acceptsRevision("telegram-user", original, edited)).toBe(true);
  expect(catalog.acceptsRevision("telegram-user", edited, original)).toBe(false);
  expect(catalog.acceptsRevision("telegram-user", edited, { ...edited, text: "Same-second correction" })).toBe(true);
  expect(catalog.acceptsRevision("telegram-user", edited, revision(null))).toBe(false);
  const deleted = revision(null, { deleted: true, text: "" });
  expect(catalog.acceptsRevision("telegram-user", edited, deleted)).toBe(true);
  expect(catalog.acceptsRevision("telegram-user", deleted, original)).toBe(false);
  expect(catalog.acceptsRevision("telegram-user", deleted, deleted)).toBe(true);
  expect(catalog.acceptsRevision("x-api", edited, original)).toBe(true);
});

test("provider CLI contributions supply only provider fields and reject absent X references", async () => {
  expect(telegramSourceExtension.cli?.connection?.({})).toEqual({ apiIdRef: "TELEGRAM_API_ID", apiHashRef: "TELEGRAM_API_HASH", sessionName: "personal" });
  expect(telegramSourceExtension.cli?.connection?.({ session: "secondary", "api-id-ref": "TG_ID", "api-hash-ref": "TG_HASH" })).toEqual({ apiIdRef: "TG_ID", apiHashRef: "TG_HASH", sessionName: "secondary" });
  expect(telegramSourceExtension.cli?.options).toEqual({ session: { type: "string" }, "api-id-ref": { type: "string" }, "api-hash-ref": { type: "string" } });
  for (const extension of xSourceExtensions) {
    expect(extension.cli?.connection?.({ "secret-ref": "X_TOKEN" })).toEqual({ secretRef: "X_TOKEN" });
    expect(() => extension.cli?.connection?.({})).toThrow(SourceFailure);
    expect(() => extension.cli?.connection?.({ "secret-ref": true })).toThrow(SourceFailure);
  }
  expect(await telegramSourceExtension.cli?.command?.(["connection", "list"], {}, { env: {}, dataDirectory: "/tmp", print() { throw new Error("Unexpected output"); } })).toBe(false);
});
