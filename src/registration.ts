import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { System1Integration } from "./contracts.js";
export const REGISTER = "pi-turbo:register:v1";
export const DISCOVER = "pi-turbo:discover:v1";
export interface Registration { version: 1; token: string; integration: System1Integration }
/** Works in either load order, including separately installed package copies. */
export function registerSystem1(pi: ExtensionAPI, integration: System1Integration): () => void {
  if (!/^[a-z][a-z0-9-]*$/.test(integration.id) || !integration.revision || typeof integration.prepareTurn !== "function") {
    throw new Error("Turbo integrations need an id, revision and prepareTurn function");
  }
  const registration: Registration = { version: 1, token: randomUUID(), integration };
  const announce = () => pi.events.emit(REGISTER, registration);
  const stop = pi.events.on(DISCOVER, announce);
  pi.on("session_start", announce);
  pi.on("session_shutdown", stop);
  announce();
  return stop;
}
