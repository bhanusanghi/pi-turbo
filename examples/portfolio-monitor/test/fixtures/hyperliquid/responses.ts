// Protocol-shaped synthetic fixtures, never a claim about a live account.
export const accountAddress = `0x${"1".repeat(40)}`;
const summary = { accountValue: "400", totalNtlPos: "120", totalRawUsd: "300", totalMarginUsed: "12" };
export const clearinghouse = (coin: string, size = "-0.002") => ({
  marginSummary: { ...summary }, crossMarginSummary: { ...summary }, crossMaintenanceMarginUsed: "6", withdrawable: "280", time: 1760000000000,
  assetPositions: [{ type: "oneWay", position: { coin, szi: size, leverage: { type: "cross", value: 10 }, entryPx: "60000", positionValue: "120", unrealizedPnl: "-1.25", returnOnEquity: "-0.1", liquidationPx: "100000", marginUsed: "12", maxLeverage: 40, cumFunding: { allTime: "0.1", sinceOpen: "0.1", sinceChange: "0.1" } } }],
});
const token = (index: number, name: string) => ({ index, name, tokenId: `0x${String(index).padStart(32, "0")}`, szDecimals: 5, weiDecimals: 8, isCanonical: true, evmContract: null, fullName: null, deployerTradingFeeShare: "0" });
const asset = { prevDayPx: "20", dayNtlVlm: "100", markPx: "21.123456789", midPx: "21", circulatingSupply: "10000", coin: "@107", totalSupply: "10000", dayBaseVlm: "5" };
const context = { prevDayPx: "60000", dayNtlVlm: "10", markPx: "60000", midPx: "60000", funding: "0", openInterest: "10", premium: "0", oraclePx: "60000", impactPxs: null, dayBaseVlm: "1" };
export const responses: Record<string, unknown> = {
  userAbstraction: "unifiedAccount",
  perpDexs: [null, { name: "xyz", fullName: "Builder DEX", deployer: accountAddress, oracleUpdater: null, feeRecipient: null, assetToStreamingOiCap: [], subDeployers: [], deployerFeeScale: "1", lastDeployerFeeScaleChangeTime: "2026-01-01T00:00:00", assetToFundingMultiplier: [], assetToFundingInterestRate: [] }],
  spotMetaAndAssetCtxs: [{ tokens: [token(0, "USDC"), token(150, "HYPE"), token(10, "USDH")], universe: [{ name: "@107", index: 107, tokens: [150, 0], isCanonical: true }] }, [asset]],
  spotClearinghouseState: { portfolioMarginEnabled: false, balances: [{ coin: "HYPE", token: 150, total: "1.000000000000000001", hold: "0.1", entryNtl: "19", spotHold: "0.05", borrowed: "0.2", supplied: "0" }, { coin: "USDC", token: 0, total: "500", hold: "20", entryNtl: "500" }] },
  "metaAndAssetCtxs/": [{ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40, marginTableId: 1 }], marginTables: [], collateralToken: 0 }, [context]],
  "metaAndAssetCtxs/xyz": [{ universe: [{ name: "xyz:XYZ", szDecimals: 5, maxLeverage: 20, marginTableId: 1 }], marginTables: [], collateralToken: 10 }, [context]],
  "clearinghouseState/": clearinghouse("BTC"),
  "clearinghouseState/xyz": clearinghouse("xyz:XYZ", "2"),
  subAccounts: [{ name: "selected separately", subAccountUser: `0x${"2".repeat(40)}`, master: accountAddress, clearinghouseState: clearinghouse("BTC"), spotState: { balances: [] } }],
};
responses.allPerpMetas = [(responses["metaAndAssetCtxs/"] as unknown[])[0], (responses["metaAndAssetCtxs/xyz"] as unknown[])[0]];
responses["meta/"] = (responses["metaAndAssetCtxs/"] as unknown[])[0];
responses["meta/xyz"] = (responses["metaAndAssetCtxs/xyz"] as unknown[])[0];
