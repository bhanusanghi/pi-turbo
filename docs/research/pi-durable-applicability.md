# Pi Durable: applicability to Turbo

Reviewed **2026-10-07**. This table records the adopted requirements and
applicability; [implementation evidence](../development.md) states what is tested. The [Pi Durable article](https://earendil.com/posts/pi-durable/)
describes a separate experimental harness. Its design principles inform Turbo;
its extension Interface is not the coding-agent extension Interface we currently target.

**V1 keeps author-managed context. Persistence and recovery are a separate concern:**
saving a task's phase does not choose which articles Jev sees. Deferring automatic
context management to V2 does not defer V1 cancellation, receipts or restart handling.

## Applicability table

Legend: 🟣 **Turbo V1** · 🔵 **author V1** · 🟢 **host capability** ·
🟡 **V2 automation** · ⚪ **outside the core**. Combined labels mean shared responsibility.

The final two columns map the guidance to our design. Host/V2 rows remain deferred;
Turbo and news V1 behavior is recorded in the implementation evidence, not inferred
from this article.

| Article topic | Applies where / when? | Application in Turbo | Why / limit |
| --- | --- | --- | --- |
| Small, extensible harness | 🟣 Turbo V1 | Keep one authored decision Interface and reusable Jev/S2 mechanics. | News and ticket products retain independent rules, tools and state. |
| Extension registry and typed tools | 🟢 Host + 🟣 Turbo V1 | Use coding-agent's factory, `pi.registerTool`, events and lifecycle today. | Durable's `defineExtension`, `defineTool` and registry require a different host integration. |
| Dynamic prompts and tool scopes | 🔵 Author + 🟣 Turbo V1 | Prepare Jev input per judgment; project approved S2 context and enforce tools at execution. | A changed prompt cannot grant permission. Preserve Pi's native prompt/tool protocol. |
| Crash checkpoints and automatic resume | 🟢 Host decision before promising auto-resume | Restore Turbo control records; classify interrupted work explicitly. Evaluate Durable if unattended continuation is required. | A saved Pi entry alone does not supply durable task replay. Do not build another scheduler inside Turbo. |
| Interrupted tool replay | 🔵 Author + 🟣 Turbo V1 | Preserve call identity, arguments and receipt; never blindly repeat an uncertain effect. | A successful send can precede the crash that loses its local receipt. |
| Submission deduplication | 🔵 Author + 🟢 Host | Use stable RSS/job IDs; use native request deduplication where the selected host supplies it. | One admitted input does not guarantee one external Telegram message. |
| Owned child work | 🟣 Turbo V1 | Bind S2 to its parent attempt; abort real work, await termination, reject late returns. | Cancelling a wait alone can leave the helper running. Ownership is not a tool grant. |
| Foreground versus background tasks | 🟣 V1 helper; ⚪ scheduler | Keep S2 foreground. Leave RSS scheduling and long-lived jobs to an explicit host/application facility. | An unfinished consultation must not be reported as completed parent work. |
| Hook ordering, wrapping and saved decisions | 🟣 Turbo V1 + 🟢 Host | Compose with native hooks; retain decision provenance and recheck current authorization. | Do not copy Durable hook names/order into coding-agent. Changed arguments/grants invalidate reused decisions. |
| Compensation after cancellation | 🔵 Author V1 | Let an effectful tool define any reconciliation or compensation policy. | Generic Turbo cannot decide how to undo an assignment or retract an alert. Cancellation does not erase effects. |
| Independent conversations and forks | 🟢 Host + 🔵 Author V1 | Scope control to session/branch/attempt; author defines state inheritance and cross-session deduplication. | Forking history does not roll back Telegram or create a separate real-world effect ledger. |
| Typed documents and atomic commits | 🔵 Author + 🟢 Host | Version author state; use native entries or an author store now. Use Durable documents only with a Durable host. | Separate Pi and database writes are not one transaction; external HTTP is outside either transaction. |
| Automatic background compaction and overflow retry | 🟡 V2; explicit exception in V1 | Prevent implicit Turbo summarization and unchanged overflow retries; preserve input and return an error. | Automatic context rewriting conflicts with V1 scope. Any host change must re-prove this exception path. |
| Manual reset and history lookup | 🔵 Author V1 | Let the author deliberately retrieve evidence or replace model context through native facilities. | A context reset is not the S2 return protocol; it supplies neither findings validation nor effect reconciliation. |
| Hot replacement of definitions | 🟢 Host + 🟣 Turbo V1 | Rediscover registered code on reload; persist IDs/schema revisions, never closures; invalidate incompatible work. | Native Pi reload is not a claim of Durable's live registry replacement semantics. |
| Pluggable storage and conformance | 🟢 Host | Select and test storage guarantees; use one owner per store where required. | A second Turbo storage engine adds no decision capability. Persistence strength depends on the actual backend/configuration. |
| Remote environments / JavaScript portability | ⚪ Host/application | Keep the Jev decision Interface independent of where tools run. | V1 does not need a remote filesystem, Cloudflare port, or environment manager. |
| Multiplayer views, subscriptions and steering | ⚪ Host/UI; 🟣 V1 stale guards | Let Pi own clients/UI; invalidate obsolete judgments when input or branch changes. | A multiplayer product is independent of providing S1/S2 execution. |
| Model/tool usage accounting | 🟣 Turbo V1 + 🟢 Host | Preserve physical model identity and actual failed, cancelled and successful work; avoid double counting. | A helper's final text is not a measure of the work it consumed. |
| Experimental package evolution | 🟣 Turbo V1 | Pin and test a supported host baseline; verify capabilities before adopting new facilities. | “Latest” and “compatible” require evidence. No automatic package migration follows from this article. |

Sources for the guidance: [article](https://earendil.com/posts/pi-durable/),
[Durable package documentation](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md),
[Durable specification](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md),
[coding-agent extension documentation](https://pi.dev/docs/latest/extensions).

## Concrete news example: an uncertain send

```text
AUTHOR TOOL     send alert with stable effectKey
EXTERNAL TOOL   accepts message
PROCESS        crashes before local receipt is saved
TURBO RESTORE  marks the call interrupted; does not infer success or retry
AUTHOR TOOL     reconciles effectKey using supported delivery records
JEV            receives confirmed receipt OR explicit unknown outcome
```

This is the required failure model. Tests reproduce unknown delivery with an external
transport double and restore an actual in-flight helper snapshot; they do not kill a
live Telegram process or establish power-loss durability. If the messaging tool cannot deduplicate or
reconcile delivery, retain `unknown` and require an explicit author/operator
resolution policy. Do not claim exactly-once delivery. Reopening a branch must
not make an already sent alert unsent.

<details>
<summary>What changes in our implementation plan</summary>

1. **Host gate:** keep coding-agent as the current target. Before advertising crash
   continuation, test the host contract or deliberately select Durable. This is
   independent of the V2 context decision.
2. **Control record:** version integration, session/branch, task, attempt, phase,
   helper identity and effective-grant revision. Keep application facts author-owned.
3. **Recovery gate:** distinguish a recorded result from an interrupted call. A
   restored phase must not automatically repeat a tool or resurrect a resolver closure.
4. **S2 gate:** parent cancellation stops owned work; acknowledge pending cancellation
   until it terminates. Retain known effects even when the helper fails or is cancelled.
5. **Compatibility gate:** test changed grants/arguments, fork/reload, uncertain sends,
   overflow recovery and actual usage through production paths.

These are additions to the [V1 implementation plan](../implementation-plan.md),
not a commitment to implement a second durable harness.

</details>

<details>
<summary>Research limits and host choice</summary>

The article is dated **2026-10-01**. The package documentation labels Durable
experimental. The linked specification still contains Pico5 and pre-implementation
wording, so use its invariants as design guidance; confirm executable contracts
against a pinned package and integration tests before adoption.

The documented storage choices have different guarantees: memory is ephemeral;
SQLite WAL with `synchronous=NORMAL` distinguishes process crashes from power loss;
JSONL durability depends on its sync configuration. An atomic commit concerns
records in that store, not an external message send.
[Storage documentation](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md),
[commit invariants](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md).

No Durable dependency has been added or executed. The existing coding-agent
provider, virtual-model and classifier research does not establish their availability
through the Durable extension Interface. If we change hosts, re-prove model routing,
tool hooks, helper scope, context exceptions and persistence before reusing that design.

</details>
