import { Type } from "typebox";
import { AppError } from "../../contracts.js";
import { SourceFailure } from "../../sources/contracts.js";
import type { SourceExtension } from "../../sources/extension.js";
import { createTradingViewClient } from "./client.js";
import { createTradingViewWebhook, tradingViewWebhookPath, type TradingViewAlert } from "./webhook.js";
const text = (max = 200) => Type.String({ minLength: 1, maxLength: max });
const object = <T extends Parameters<typeof Type.Object>[0]>(fields: T) => Type.Object(fields, { additionalProperties: false });
const secretRef = Type.String({pattern:"^[A-Z][A-Z0-9_]{0,99}$"});
const ids = ["tradingview-headlines", "tradingview-api", "tradingview-webhook"] as const;
export const tradingViewSourceExtensions: SourceExtension[] = ids.map(id => ({
  id,
  connectionSchema: object({label:text(),enabled:Type.Boolean(),adapter:Type.Literal(id),
    secretRef: id === "tradingview-headlines" ? Type.Optional(secretRef) : secretRef}),
  validateWatch(_connection, watch) {
    if (!/^[A-Za-z0-9_-]+:[A-Za-z0-9_][A-Za-z0-9_.!/-]*$/.test(watch.target)) throw new AppError("invalid_input", "TradingView target must be EXCHANGE:TICKER");
    if ((watch.mode === "push") !== (id === "tradingview-webhook")) throw new AppError("invalid_input", "Webhook connections require push mode; headline connections require poll mode");
  },
  createClient(context) {
    return id === "tradingview-webhook" ? createTradingViewWebhook(context).client : createTradingViewClient(context);
  },
  ...(id === "tradingview-webhook" ? {receivers(context) {
    const webhook = createTradingViewWebhook(context);
    return [{path:tradingViewWebhookPath,
      params:object({sourceId:Type.String({pattern:"^[0-9a-fA-F-]{36}$"}),token:Type.String({minLength:32,maxLength:128,pattern:"^[A-Za-z0-9_-]+$"})}),
      body:object({eventId:text(200),symbol:text(200),triggeredAt:text(40),text:text(100000)}),
      receive(params,body) {return webhook.receive(params.sourceId!,params.token!,body as TradingViewAlert);},
    }];
  }} satisfies Pick<SourceExtension,"receivers"> : {}),
  cli: {
    help: `  ${id}: --target EXCHANGE:TICKER${id === "tradingview-webhook" ? " --mode push" : ""}; --secret-ref REF${id === "tradingview-headlines" ? " optional" : " required"}\n`,
    connection(values) {
      const ref = values["secret-ref"];
      if (typeof ref === "string" && ref.trim()) return {secretRef:ref};
      if (id === "tradingview-headlines") return {};
      throw new SourceFailure("configuration", "--secret-ref is required");
    },
  },
}));
