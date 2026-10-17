import { AppError, type AppStore } from "./contracts.js";

/** Inspection only: no evidence projection or model input selection. */
export async function inspectPortfolio(store: AppStore, portfolioId: string, maxAgeMs = 120_000) {
  const portfolio = await store.getResource("portfolios", portfolioId);
  if (!portfolio) throw new AppError("not_found", "Portfolio not found", 404);
  const snapshot = await store.latestPortfolioSnapshot(portfolioId);
  const reasons: string[] = [];
  if (!portfolio.enabled) reasons.push("portfolio_disabled");
  if (!snapshot) return { snapshot: null, fresh: false, reasons: [...reasons, "awaiting_snapshot"] };
  if (snapshot.portfolioRevision !== portfolio.revision) reasons.push("portfolio_configuration_changed");
  if (snapshot.coverage === "partial") reasons.push("partial_coverage");
  for (const accountId of portfolio.accountIds) {
    const account = await store.getResource("accounts", accountId);
    const saved = snapshot.accountSnapshots.find(s => s.accountId === accountId);
    if (!account?.enabled) reasons.push(`account_unavailable:${accountId}`);
    if (!saved) reasons.push(`missing_snapshot:${accountId}`);
    else {
      if (saved.accountRevision !== account?.revision) reasons.push(`account_configuration_changed:${accountId}`);
      if (Date.now() - Date.parse(saved.startedAt) > maxAgeMs) reasons.push(`stale:${accountId}`);
    }
  }
  return { snapshot, fresh: reasons.length === 0, reasons };
}
