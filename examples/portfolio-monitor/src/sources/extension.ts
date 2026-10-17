import type { TSchema } from "typebox";
import type { AppStore } from "../contracts.js";
import type { SourceDefinition } from "./catalog.js";
import type { SourceClient } from "./contracts.js";

export type SourceContext = {
  store: AppStore;
  resolveSecret(name: string): Promise<string>;
  dataDirectory: string;
  onError(error: unknown): void;
};
export type SourceCliValues = Record<string, string | boolean | undefined>;
export type SourceCliContext = { env: NodeJS.ProcessEnv; dataDirectory: string; print(value: string): void };
/** Trusted application code. Each receiver authenticates its request before admission. */
export type SourceReceiver = {
  path: string;
  params: TSchema;
  body: TSchema;
  receive(params: Record<string, string>, body: unknown): Promise<unknown>;
};
/** One registration owns protocol configuration, policy, transport and optional setup. */
export interface SourceExtension extends SourceDefinition {
  createClient(context: SourceContext): SourceClient;
  receivers?(context: SourceContext): SourceReceiver[];
  cli?: {
    help?: string;
    options?: Record<string, { type: "string" | "boolean" }>;
    connection?(values: SourceCliValues): Record<string, unknown>;
    command?(positionals: string[], values: SourceCliValues, context: SourceCliContext): Promise<boolean>;
  };
}
