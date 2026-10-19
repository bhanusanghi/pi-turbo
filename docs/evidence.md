# Retained decision evidence

`createTurbo` accepts an optional `evidence` writer. `createNativeEvidenceStore` supplies the native implementation through public Pi Durable 1.2.0 host APIs. Existing callers can omit the writer.

## Record and reference

`System1Evidence` has `version: 1` and the following fields.

| Field | Stored value |
| --- | --- |
| `integrationId`, `revision` | Authored integration identity and interpretation version. |
| `conversationId`, `generationId` | Native conversation and GenerationTask identity. |
| `input` | Saved prepared request and bindings, or the authored final decision. Absent when preparation fails before a packet is saved. |
| `answer` | Actual native classifier result, including reported errors or aborted responses, when available. |
| `outcome` | Either the mapped `decision` or a `diagnostic` string. |
| `response` | The translated assistant response prepared for native execution. This is an intended response, not a tool receipt. |
| `consultation` | The preceding consultation's ToolTask ID and child conversation ID, when present. |

`EvidenceReference` contains the integration, revision, conversation, and generation identity plus `entryId`. The host identifies the storage that contains that reference. IDs are local to that storage.

The native `System1EvidenceEntry` kind is `turbo.system1-evidence.v1`. Its payload has no `model` field. Native conversation history holds tool calls, results, and System 2 transcripts separately. The record describes observable inputs and outputs. It does not capture hidden reasoning or claim to archive exact provider-wire requests after host transforms.

## Host integration

The host owns the Harness and persistent storage. HookApi has no commit method. The writer therefore closes over a host-owned store. This bootstrap excerpt waits for the store before resumed tasks record evidence.

```ts
import { createNativeEvidenceStore, createTurbo } from "pi-turbo";

const storeReady = Promise.withResolvers<ReturnType<typeof createNativeEvidenceStore>>();
const turbo = createTurbo({
	integration,
	classifier,
	tools: productTools,
	evidence: async (record, context) => (await storeReady.promise).write(record, context),
});
// Install product and Turbo extensions, then open the native Harness.
const harness = await Harness.open(storage, { registry, models }, context);
const evidence = createNativeEvidenceStore(harness);
storeReady.resolve(evidence);
```

`store.write(record, context)` returns `Promise<EvidenceReference>`. A conversation-scoped document family indexes each integration, revision, and generation. The entry and index share one native transaction. Identical writes return the existing reference. Conflicting contents throw `Conflicting retained Turbo evidence` and preserve the original entry.

`store.read(identity, context)` returns `{ reference, evidence }`, or `undefined` when no record exists. The read uses the retained index and immutable entry. Reset and model context compaction do not remove that index. `System1EvidenceEntry.is(entry)` narrows records returned by native history queries.

## Failure and recovery

Turbo saves the decision and evidence in the native recovery memo before calling the writer. The writer runs outside the catch that records decision failures. A recording error cannot replace an already saved decision with a different classification.

When the writer throws, no signed bridge envelope reaches the provider. Durable reports and skips the failed hook, then the local provider rejects its unsigned input. In the tested host with retries disabled, the submission settles `unanswered` and no product tool runs. This terminal attempt's task memos are removed. A later submission is a new generation and may classify again.

When the process closes or dies while recording is pending, Durable retains the unfinished generation. Recovery invokes the writer with the same saved record. A prior native commit returns its original entry, then Turbo releases the saved response without another inference. The SIGKILL test exercises a crash after the evidence commit and before the writer returns.

A changed integration revision rejects a pending saved response. Enabling evidence on an older pending generation that lacks the new record is unsupported. Finish pending work with its original options before enabling retention. No recorder remains compatible with pending responses from the earlier runtime.

A classifier result with `stopReason: "error"` or `"aborted"` records a diagnostic. Cancellation of the native task can interrupt the writer itself. The contract does not guarantee a retained record for every cancelled or uncommitted inference.

## Host responsibilities

The application controls who can inspect these records, including any developer mode in its API or browser. Turbo supplies no authentication or product access policy. Application instructions do not grant access to stored records.

Use one process for one native storage backend. Keep the storage durable across host restarts. The native entry does not establish completion of a tool, notification, or external effect. Use native tool evidence and application receipts for those outcomes.

No TTL or hard-delete API is added. `documentRetentionMs` controls the native in-memory document cache, not disk retention. Applications choose archival and deletion requirements before retaining sensitive prompts or tool output.
