import { Type } from "typebox";
import type { SourceExtension } from "../../src/sources/extension.js";
import { SourceFailure } from "../../src/sources/contracts.js";
export const fixtureSource: SourceExtension = {
  id:"fixture-source",
  connectionSchema:Type.Object({adapter:Type.Literal("fixture-source"),label:Type.String({minLength:1,maxLength:200}),enabled:Type.Boolean(),secretRef:Type.String({pattern:"^[A-Z][A-Z0-9_]{0,99}$"})},{additionalProperties:false}),
  validateWatch(_connection,watch) {if(watch.mode === "push") throw new SourceFailure("configuration","Fixture collector requires poll mode");},
  createClient() {throw new Error("Tests must supply the fixture transport explicitly");},
  cli:{connection(values) {if(typeof values["secret-ref"] !== "string") throw new SourceFailure("configuration","--secret-ref is required");return {secretRef:values["secret-ref"]};}},
};
