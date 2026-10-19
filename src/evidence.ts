import type { JsonRepresentation } from "@earendil-works/chord";
import { defineDocFamily, defineEntry, type Entry, type EntryId, type Harness } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import type { EvidenceIdentity, EvidenceReference, EvidenceWriter, System1Evidence } from "./contracts.js";
import { json, object, same } from "./runtime/protocol.js";

export const System1EvidenceEntry: Entry<JsonRepresentation<System1Evidence>> = defineEntry<JsonRepresentation<System1Evidence>>("turbo.system1-evidence.v1");
const Index = defineDocFamily({ kind: "turbo.system1-evidence-index", version: 1,
  scope: "conversation", history: "latest", fork: "initial", family: true,
  initial: () => ({ entryId: null as EntryId | null }),
});
const key = (id: EvidenceIdentity) => JSON.stringify([id.integrationId, id.revision, id.generationId]);
const reference = (id: EvidenceIdentity, entryId: EntryId): EvidenceReference => ({
  integrationId: id.integrationId, revision: id.revision, conversationId: id.conversationId,
  generationId: id.generationId, entryId,
});

/** One host owns the native storage. The entry and its idempotency index share a commit. */
export function createNativeEvidenceStore(host: Pick<Harness, "commit" | "snapshot">) {
  const write: EvidenceWriter = async (evidence, context) => {
    object(evidence);
    if (evidence.version !== 1 || !evidence.integrationId || !evidence.revision
      || !Number.isSafeInteger(evidence.conversationId) || evidence.conversationId <= 0
      || !Number.isSafeInteger(evidence.generationId) || evidence.generationId <= 0) {
      throw new Error("Invalid Turbo evidence identity");
    }
    const data = json(evidence) as JsonRepresentation<System1Evidence>;
    return host.commit(async tx => {
      const index = await tx.doc(Index, evidence.conversationId, key(evidence), null);
      if (index.entryId !== null) {
        const existing = await tx.entry(System1EvidenceEntry, index.entryId);
        if (!existing || existing.conversationId !== evidence.conversationId || !same(existing.data, data)) {
          throw new Error("Conflicting retained Turbo evidence");
        }
        return reference(evidence, existing.id);
      }
      const entry = await tx.appendEntry(System1EvidenceEntry, evidence.conversationId, { data });
      index.entryId = entry.id;
      return reference(evidence, entry.id);
    }, context);
  };
  async function read(identity: EvidenceIdentity, context: Context) {
    const index = await host.snapshot(Index, identity.conversationId, key(identity), context);
    const entryId = index?.entryId;
    if (entryId == null) return undefined;
    const entry = await host.commit(tx => tx.entry(System1EvidenceEntry, entryId), context);
    if (!entry || entry.conversationId !== identity.conversationId || !same(reference(entry.data, entry.id), reference(identity, entry.id))) {
      throw new Error("Invalid retained Turbo evidence index");
    }
    return { reference: reference(identity, entry.id), evidence: structuredClone(entry.data) as System1Evidence };
  }
  return { write, read };
}
