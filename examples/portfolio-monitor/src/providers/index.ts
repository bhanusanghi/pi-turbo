import type { SourceExtension } from "../sources/extension.js";
import { tradingViewSourceExtensions } from "./tradingview/index.js";

/** Application composition; shared lifecycle/storage code lives outside these providers. */
export const sourceExtensions: readonly SourceExtension[] = [...tradingViewSourceExtensions];
