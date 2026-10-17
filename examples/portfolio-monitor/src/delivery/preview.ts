import type { DeliveryAdapter } from "../contracts.js";

export const previewAdapter: DeliveryAdapter = {
  async send(destination, text, signal) {
    if (destination.adapter !== "preview") return { status: "rejected", error: "Preview adapter received another destination type" };
    if (signal.aborted) return { status: "rejected", error: "Delivery cancelled before transmission" };
    return { status: "previewed", receipt: { provider: "preview", text } };
  },
};
