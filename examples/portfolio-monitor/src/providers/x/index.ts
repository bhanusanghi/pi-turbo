import { Type } from "typebox";
import { AppError } from "../../contracts.js";
import { SourceFailure } from "../../sources/contracts.js";
import type { SourceExtension } from "../../sources/extension.js";
import { createXApiClient } from "./api.js";
import { createXSessionClient } from "./session.js";
import { xTarget } from "./common.js";

function extension(id: "x-api" | "x-session"): SourceExtension {
  return {
    id,
    connectionSchema: Type.Object({ label: Type.String({ minLength: 1, maxLength: 200 }), enabled: Type.Boolean(), adapter: Type.Literal(id), secretRef: Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,99}$" }) }, { additionalProperties: false }),
    validateWatch(_connection, watch) {
      if (watch.mode !== undefined && watch.mode !== "poll") throw new AppError("invalid_input", "X sources require poll mode");
      try { xTarget(watch.target); } catch { throw new AppError("invalid_input", "Use an X account username or numeric account ID"); }
    },
    createClient(context) { return id === "x-api" ? createXApiClient({ resolveSecret: context.resolveSecret }) : createXSessionClient({ resolveSecret: context.resolveSecret }); },
    cli: {
      help: `  bun run sources connection add --adapter ${id} --name X --secret-ref ${id === "x-api" ? "X_API_TOKEN" : "X_SESSION"}${id === "x-session" ? "\n    X cookie access is experimental." : ""}`,
      connection(values) {
        const secretRef = values["secret-ref"];
        if (typeof secretRef !== "string" || !secretRef.trim()) throw new SourceFailure("configuration", "--secret-ref is required");
        return { secretRef };
      },
    },
  };
}
export const xSourceExtensions: readonly SourceExtension[] = [extension("x-session"), extension("x-api")];
