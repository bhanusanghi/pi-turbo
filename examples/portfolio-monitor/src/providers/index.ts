import type { SourceExtension } from "../sources/extension.js";

/** Application composition: each source PR contributes its registrations here. */
export const sourceExtensions: readonly SourceExtension[] = [];
