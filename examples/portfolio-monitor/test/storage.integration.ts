import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SQL } from "bun";
import { createStore } from "../src/storage/index.js";
import type { Account, AccountObservation, InputDraft } from "../src/contracts.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const key = () => randomUUID();
function observed(account: Account, exposureHash = "holdings-1"): AccountObservation {
  return { accountId: account.id, network: account.network, address: account.address, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), positions: [{ kind: "spot", accountId: account.id, instrumentId: `${account.network}:hyperliquid:spot:1`, tokenId: 1, venueSymbol: "HYPE", total: "2.50", hold: "0", spotHold: null, value: null }], accountMode: "default", accountFacts: {}, coverage: [{ part: "spot", status: "complete", receivedAt: new Date().toISOString() }, { part: "perps", status: "complete", receivedAt: new Date().toISOString() }], issues: [], exposureHash, raw: {} };
}
test.skipIf(Boolean(!databaseUrl && "Set TEST_DATABASE_URL for real PostgreSQL integration tests"))("PostgreSQL production store transactions, revisions, refreshes, scope and delivery admission", async () => {
  const admin = new SQL(databaseUrl!);
  const schemaName = `test_storage_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE SCHEMA ${schemaName}`);
  const isolatedUrl = new URL(databaseUrl!);
  isolatedUrl.searchParams.set("options", `-c search_path=${schemaName}`);
  const store = createStore(isolatedUrl.toString());
  try {
    await store.migrate();
    await store.health();
    const source = await store.createResource("sources", { name: key(), kind: "manual", enabled: true }, key());
    const otherSource = await store.createResource("sources", { name: key(), kind: "manual", enabled: true }, key());
    const account = await store.createResource("accounts", { label: "Test Hyperliquid", address: `0x${randomUUID().replaceAll("-", "")}12345678`, network: "testnet", perpDexs: "all", enabled: true }, key());
    const portfolio = await store.createResource("portfolios", { name: key(), accountIds: [account.id], enabled: true }, key());
    const destination = await store.createResource("destinations", { label: key(), adapter: "preview", enabled: true }, key());
    const monitor = await store.createResource("monitors", { name: key(), portfolioId: portfolio.id, sourceIds: [source.id], destinationIds: [destination.id], enabled: true }, key());
    { // resource idempotency rejects changed payload, references and unknown patch fields
      const requestKey = key();
      const draft = { name: key(), kind: "manual" as const, enabled: true };
      const [a, b] = await Promise.all([store.createResource("sources", draft, requestKey), store.createResource("sources", draft, requestKey)]);
      assert.equal(a.id, b.id);
      await assert.rejects(store.createResource("sources", { ...draft, name: "changed" }, requestKey), { code: "idempotency_conflict" });
      await assert.rejects(store.createResource("portfolios", { name: "bad", accountIds: [key()], enabled: true }, key()), { code: "not_found" });
      await assert.rejects(store.updateResource("sources", source.id, { id: key() } as never, key()), { code: "invalid_input" });
      assert.equal((await store.getResource("sources", source.id))!.revision, 1);
    }
    let revisionId = "";
    { // ingress unchanged duplicates don't evaluate, correction revisions preserve provenance
      const draft: InputDraft = { sourceItemId: key(), kind: "article", publishedAt: null, text: "First report", sourceRevision: "1", relatesTo: [{ sourceItemId: "earlier", relation: "correction" }] };
      const first = await store.acceptInput(source.id, draft, key());
      revisionId = first.revisionId;
      assert.equal(first.duplicate, false);
      assert.equal(first.evaluationIds.length, 1);
      const duplicate = await store.acceptInput(source.id, { ...draft, sourceRevision: "2" }, key());
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.revisionId, first.revisionId);
      assert.deepEqual(duplicate.evaluationIds, []);
      await assert.rejects(store.acceptInput(source.id, { ...draft, sourceRevision: "2", text: "Tampered same provider revision" }, key()), { code: "revision_conflict" });
      const updated = await store.acceptInput(source.id, { ...draft, sourceRevision: "3", text: "Corrected report" }, key());
      assert.notEqual(updated.revisionId, first.revisionId);
      assert.equal(updated.evaluationIds.length, 1);
      const record = (await store.getInput(first.inputId))!;
      assert.equal(record.revisions.length, 2);
      assert.deepEqual(record.revisions[1]!.relatesTo, draft.relatesTo);
      const evaluation = (await store.getEvaluation(first.evaluationIds[0]!))!;
      assert.equal(evaluation.status, "awaiting_evaluator");
      assert.equal(evaluation.monitorRevision, 1);
      assert.equal(evaluation.cutoffSequence, record.revisions[0]!.sequence);
      const other = await store.acceptInput(otherSource.id, { ...draft, sourceRevision: undefined }, key());
      assert.deepEqual(other.evaluationIds, []);
      await assert.rejects(store.requestEvaluation(monitor.id, { kind: "input", revisionId: other.revisionId }, key()), { code: "scope" });
      const page = await store.listInputs({ sourceId: source.id, limit: 1 });
      assert.equal(page.items.length, 1);
      assert.ok(page.nextCursor);
      assert.equal((await store.listInputs({ sourceId: source.id, cursor: page.nextCursor!, limit: 1 })).items[0]!.id, updated.revisionId);
    }
    { // refreshes coalesce, dirty running refresh creates one followup and exposure changes evaluate
      const [first, coalesced] = await Promise.all([store.requestRefresh(account.id, "api", key()), store.requestRefresh(account.id, "websocket", key())]);
      assert.equal(first.id, coalesced.id);
      assert.equal((await store.beginRefresh(first.id))!.status, "running");
      assert.equal(await store.beginRefresh(first.id), null);
      const dirty = await store.requestRefresh(account.id, "websocket-during-read", key());
      assert.equal(dirty.id, first.id);
      assert.equal(dirty.dirty, true);
      await store.finishRefresh(first.id, observed(account));
      const snapshot = (await store.latestPortfolioSnapshot(portfolio.id))!;
      assert.equal(snapshot.coverage, "complete");
      assert.equal(snapshot.positions.length, 1);
      const evals = await store.listEvaluations({ monitorId: monitor.id });
      assert.ok(evals.items.some(e => e.trigger.kind === "portfolio" && e.trigger.snapshotId === snapshot.id));
      const ownFollowups = async () => { const pending = await store.pendingDispatches(1000); const matches = []; for (const d of pending)
        if (d.queue === "portfolio.refresh" && d.recordId !== first.id && (await store.getRefresh(d.recordId))?.accountId === account.id)
          matches.push(d); return matches; };
      const followups = await ownFollowups();
      assert.equal(followups.length, 1);
      await store.finishRefresh(first.id, observed(account));
      assert.equal((await ownFollowups()).length, 1);
      await store.beginRefresh(followups[0]!.recordId);
      await store.finishRefresh(followups[0]!.recordId, observed(account));
      assert.equal((await store.listEvaluations({ monitorId: monitor.id })).items.length, evals.items.length, "price/time-only refresh doesn't evaluate unchanged exposure");
      await store.updateResource("accounts", account.id, { perpDexs: [""] }, key());
      assert.equal(await store.latestAccountSnapshot(account.id), null);
      assert.equal((await store.latestPortfolioSnapshot(portfolio.id))!.coverage, "partial");
      await store.updateResource("portfolios", portfolio.id, { accountIds: [] }, key());
      assert.equal(await store.latestPortfolioSnapshot(portfolio.id), null);
    }
    { // notification durable admission, due retry, terminal unknown and provider receipt
      const draft = { destinationId: destination.id, content: { title: "Test", body: "Evidence is retained" }, origin: "operator_test" as const, evidenceRevisionIds: [revisionId] };
      const requestKey = key();
      const delivery = await store.requestNotification(draft, requestKey);
      assert.equal((await store.requestNotification(draft, requestKey)).id, delivery.id);
      await assert.rejects(store.requestNotification({ ...draft, content: { title: "Changed", body: "Changed" } }, requestKey), { code: "idempotency_conflict" });
      const [a, b] = await Promise.all([store.beginDelivery(delivery.id, "Test\nEvidence"), store.beginDelivery(delivery.id, "Test\nEvidence")]);
      assert.equal([a, b].filter(Boolean).length, 1);
      const retry = await store.finishDelivery(delivery.id, { status: "retry", error: "confirmed rate limit", retryAfterMs: 0 });
      assert.equal(retry.status, "queued");
      assert.equal(retry.attempts, 1);
      assert.equal((await store.beginDelivery(delivery.id, "Test\nEvidence"))!.attempts, 2);
      const result = await store.finishDelivery(delivery.id, { status: "sent", receipt: { message_id: 123 } });
      assert.equal(result.status, "sent");
      assert.deepEqual(result.receipt, { message_id: 123 });
      assert.equal(await store.beginDelivery(delivery.id, "Test"), null);
      const uncertain = await store.requestNotification(draft, key());
      await store.beginDelivery(uncertain.id, "Test");
      await store.finishDelivery(uncertain.id, { status: "unknown", error: "network timeout" });
      assert.equal(await store.beginDelivery(uncertain.id, "Test"), null);
      const changed = await store.requestNotification(draft, key());
      await store.updateResource("destinations", destination.id, { label: "Changed destination configuration" }, key());
      assert.equal(await store.beginDelivery(changed.id, "Test"), null);
      assert.equal((await store.getDelivery(changed.id))!.status, "rejected");
    }
    { // configuration changes during a read cannot publish a current snapshot
      const before = (await store.getResource("accounts", account.id))!;
      const request = await store.requestRefresh(account.id, "config-race", key());
      await store.beginRefresh(request.id);
      const after = await store.updateResource("accounts", account.id, { perpDexs: "all" }, key());
      await store.finishRefresh(request.id, observed(before, "old-config"));
      assert.equal(await store.latestAccountSnapshot(account.id), null);
      const active = [];
      for (const d of await store.pendingDispatches(1000))
        if (d.queue === "portfolio.refresh") {
          const r = await store.getRefresh(d.recordId);
          if (r?.accountId === account.id && r.status === "queued")
            active.push(r);
        }
      assert.equal(active.length, 1);
      await store.beginRefresh(active[0]!.id);
      const observation = observed(after, "new-config");
      observation.positions.push({ kind: "perp", accountId: account.id, instrumentId: "testnet:hyperliquid:perp:XYZ", dex: "", venueCoin: "XYZ", signedSize: "-1", side: "short", entryPrice: null, notional: null, unrealizedPnl: null, marginMode: "unknown", leverage: null, liquidationPrice: null });
      observation.coverage.push({ part: "unknown-perp-margin", status: "unsupported", receivedAt: new Date().toISOString(), issue: "Keep unrecognized exposure" });
      await store.finishRefresh(active[0]!.id, observation);
      const snapshot = (await store.latestAccountSnapshot(account.id))!;
      assert.equal(snapshot.accountRevision, after.revision);
      assert.equal(snapshot.positions.length, 2);
      assert.equal(snapshot.coverage.at(-1)!.status, "unsupported");
    }
    { // portfolio refresh is atomic and accepts stable 200-character keys across portfolios/configurations
      const makeAccount = (enabled: boolean) => store.createResource("accounts", { label: key(), address: `0x${randomUUID().replaceAll("-", "")}12345678`, network: "testnet", perpDexs: "all", enabled }, key());
      const enabled = await makeAccount(true), disabled = await makeAccount(false), separate = await makeAccount(true);
      const p = await store.createResource("portfolios", { name: key(), accountIds: [enabled.id, disabled.id], enabled: true }, key());
      const other = await store.createResource("portfolios", { name: key(), accountIds: [separate.id], enabled: true }, key());
      const longKey = "k".repeat(200);
      await assert.rejects(store.requestPortfolioRefresh(p.id, longKey), { code: "disabled" });
      const before = [];
      for (const d of await store.pendingDispatches(1000))
        if (d.queue === "portfolio.refresh") {
          const r = await store.getRefresh(d.recordId);
          if (r && [enabled.id, disabled.id].includes(r.accountId))
            before.push(r);
        }
      assert.equal(before.length, 0, "failed whole command must enqueue no account");
      await store.updateResource("accounts", disabled.id, { enabled: true }, key());
      const [requests, duplicate] = await Promise.all([store.requestPortfolioRefresh(p.id, longKey), store.requestPortfolioRefresh(p.id, longKey)]);
      assert.equal(requests.length, 2);
      assert.deepEqual(duplicate, requests);
      const otherRequests = await store.requestPortfolioRefresh(other.id, longKey);
      assert.equal(otherRequests.length, 1);
      assert.equal(otherRequests[0]!.accountId, separate.id);
      await store.updateResource("portfolios", p.id, { accountIds: [separate.id], enabled: false }, key());
      await store.updateResource("accounts", enabled.id, { enabled: false }, key());
      assert.deepEqual(await store.requestPortfolioRefresh(p.id, longKey), requests, "accepted scope is stable across subsequent membership and enabled changes");
      await assert.rejects(store.requestPortfolioRefresh(p.id, key()), { code: "disabled" });
      await assert.rejects(store.requestPortfolioRefresh(other.id, "k".repeat(201)), { code: "invalid_input" });
    }
    { // RFC3339 leap dates and timezone offsets are accepted without chronology fabrication
      const accepted = await store.acceptInput(source.id, { sourceItemId: key(), kind: "article", publishedAt: "2024-02-29T23:59:59.123+05:30", text: "Provider-supplied valid leap day" }, key());
      assert.equal((await store.getInput(accepted.inputId))!.revisions[0]!.publishedAt, "2024-02-29T23:59:59.123+05:30");
    }
    { // portfolio membership updates and refresh completion do not deadlock on foreign-key locks
      const lockAccount = await store.createResource("accounts", { label: key(), address: `0x${randomUUID().replaceAll("-", "")}12345678`, network: "testnet", perpDexs: "all", enabled: true }, key());
      const lockPortfolio = await store.createResource("portfolios", { name: key(), accountIds: [lockAccount.id], enabled: true }, key());
      const request = await store.requestRefresh(lockAccount.id, "membership-race", key());
      await store.beginRefresh(request.id);
      const token = key();
      const updaterName = `membership_update_${token}`;
      const finisherName = `refresh_finish_${token}`;
      const updaterUrl = new URL(isolatedUrl);
      updaterUrl.searchParams.set("application_name", updaterName);
      const finisherUrl = new URL(isolatedUrl);
      finisherUrl.searchParams.set("application_name", finisherName);
      const updater = createStore(updaterUrl.toString()), finisher = createStore(finisherUrl.toString());
      const barrier = await admin.reserve();
      await admin.unsafe(`CREATE FUNCTION ${schemaName}.membership_barrier() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF NEW.owner_id='${lockPortfolio.id}'::uuid THEN PERFORM pg_advisory_xact_lock(hashtextextended('${token}',0)); END IF; RETURN NEW; END $body$`);
      await admin.unsafe(`CREATE TRIGGER membership_barrier BEFORE INSERT ON ${schemaName}.pm_memberships FOR EACH ROW EXECUTE FUNCTION ${schemaName}.membership_barrier()`);
      await barrier.unsafe("SELECT pg_advisory_lock(hashtextextended($1,0))", [token]);
      const waitFor = async (applicationName: string, predicate: (r: {
        wait_event_type: string;
        wait_event: string;
        blockers: number[];
      }) => boolean) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const rows = await admin.unsafe<{
            wait_event_type: string;
            wait_event: string;
            blockers: number[];
          }[]>("SELECT wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE application_name=$1 AND state='active'", [applicationName]);
          if (rows.some(predicate))
            return;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.fail(`Production operation ${applicationName} did not reach expected database lock barrier`);
      };
      const capture = <T>(promise: Promise<T>) => promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      let updateResult: ReturnType<typeof capture> | undefined;
      let finishResult: ReturnType<typeof capture> | undefined;
      try {
        updateResult = capture(updater.updateResource("portfolios", lockPortfolio.id, { name: "Concurrent membership rewrite" }, key()));
        await waitFor(updaterName, r => r.wait_event_type === "Lock" && r.wait_event === "advisory");
        finishResult = capture(finisher.finishRefresh(request.id, observed(lockAccount)));
        try {
          await waitFor(finisherName, r => r.wait_event_type === "Lock" && r.blockers.length > 0);
        }
        catch (error) {
          const result = await finishResult;
          if (!result.ok)
            throw result.error;
          throw error;
        }
        await barrier.unsafe("SELECT pg_advisory_unlock(hashtextextended($1,0))", [token]);
        const [updated, finished] = await Promise.all([updateResult, finishResult]);
        assert.equal(updated.ok, true, updated.ok ? undefined : String(updated.error));
        assert.equal(finished.ok, true, finished.ok ? undefined : String(finished.error));
        assert.equal((await store.getRefresh(request.id))!.status, "completed");
        const snapshot = (await store.latestPortfolioSnapshot(lockPortfolio.id))!;
        assert.equal(snapshot.portfolioRevision, 2);
        assert.equal(snapshot.positions.length, 1);
      }
      finally {
        await barrier.unsafe("SELECT pg_advisory_unlock(hashtextextended($1,0))", [token]);
        await Promise.all([updateResult, finishResult]);
        barrier.release();
        await updater.close();
        await finisher.close();
        await admin.unsafe(`DROP TRIGGER membership_barrier ON ${schemaName}.pm_memberships`);
        await admin.unsafe(`DROP FUNCTION ${schemaName}.membership_barrier()`);
      }
    }
    { // outbox is inspectable and mark/fail retain business work
      const pending = await store.pendingDispatches();
      assert.ok(pending.length);
      assert.ok(pending.every((d, i) => i === 0 || BigInt(d.sequence) > BigInt(pending[i - 1]!.sequence)));
      const dispatch = pending[0]!;
      await store.failDispatch(dispatch.id, "Redis unavailable");
      assert.equal((await store.pendingDispatches()).find(d => d.id === dispatch.id)!.attempts, 1);
      await store.markDispatched(dispatch.id);
      assert.ok(!(await store.pendingDispatches()).some(d => d.id === dispatch.id));
    }
  }
  finally {
    await store.close();
    await admin.unsafe(`DROP SCHEMA ${schemaName} CASCADE`);
    await admin.close();
  }
}, 60000);
