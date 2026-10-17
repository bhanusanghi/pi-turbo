import type { SourceExtension } from "../sources/extension.js";
import { telegramSourceExtension } from "./telegram/index.js";
import { xSourceExtensions } from "./x/index.js";

/** Application composition; shared lifecycle/storage code lives outside these providers. */
export const sourceExtensions: readonly SourceExtension[] = [telegramSourceExtension, ...xSourceExtensions];
