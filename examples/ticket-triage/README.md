# Ticket classification and assignment

Pseudocode and synthetic values. This independent ticket companion is not implemented;
the reusable Turbo V1 runtime and Hyperliquid/news companion are implemented.
This is independent of the news agent: its own integration, session, state and tools.
Only the generic Turbo runtime is shared.

## What the author provides

- Pi tools: `read_ticket`, optional `read_account`, `assign_ticket`, and optional helper.
- The routing taxonomy, relevant account fields, goal, criteria, and Jev questions.
- Stable bindings from answer IDs to concrete tool names/arguments.
- A state reducer that records returned evidence and an authored completion criterion.
- When consultation is available/required and the exact helper request.

Tools can be installed separately. The companion extension registers its integration
through the proposed seam; it does not give tool ownership to the runtime.

## One input and decision

```json
{
  "goal": "Classify and assign ticket T42",
  "ticket": { "id": "T42", "text": "My card was charged twice." },
  "routingCriteria": "Payments handles charges/refunds; technical handles product faults; SOS handles author-defined urgent incidents. Urgency criteria take precedence when applicable.",
  "availableActions": ["assign_payments", "assign_technical", "assign_sos", "read_account", "ask_user"]
}
```

This is illustrative authored state, not an official Jev API schema. The author
wraps it in the questions/criteria expected by their selected backend.

```ts
// Author code: bind the answers explicitly.
const actions = {
  assign_payments: {
    kind: "tool", name: "assign_ticket",
    args: { ticketId: ticket.id, team: "payments" },
  },
  assign_technical: {
    kind: "tool", name: "assign_ticket",
    args: { ticketId: ticket.id, team: "technical" },
  },
  assign_sos: {
    kind: "tool", name: "assign_ticket",
    args: { ticketId: ticket.id, team: "incident-response" },
  },
  read_account: {
    kind: "tool", name: "read_account",
    args: { accountId: ticket.accountId },
  },
};
// Build a Jev question from authored choices/criteria.
// Resolve its answer through these bindings; validate against the offered choices.
```

If consultation is enabled, the author can add a helper action with an explicit
request. Disabling it changes the authored action space; there is no invented helper.

## Trace

| Step | Tool/model input | Output and next judgment |
| --- | --- | --- |
| Read | `read_ticket("T42")` | Text and account reference; Jev chooses assignment, account lookup, help, or clarification. |
| Decide | Ticket, routing criteria, relevant evidence, offered choices | Illustrative expected choice: `assign_payments`; author maps it to `assign_ticket`. |
| Execute | Ticket ID and bound team | Illustrative receipt `{ ticketId: "T42", team: "payments", assigned: true }`. |
| Finish | Original goal and relevant receipt | Jev judges whether classification and assignment are complete. |

If assignment fails, preserve the actual failure for the next judgment. A returned
choice is not an executed assignment; a missing receipt is unknown, not success.

## Where System 2 fits

For an ambiguous ticket, Jev can select the enabled built-in System 2 mechanism
with an author-supplied brief. The LLM can inspect allowed account/ticket tools over
several Pi turns, then return evidence to Jev for assignment. The operator grants
the helper's model/tools/scope/ceilings; Turbo enforces them. No universal confidence
cutoff is supplied by the core. See the [handover design](../../ARCHITECTURE.md#built-in-optional-system-2).

## History and observation

Retain the ticket/goal and relevant assignment receipt in working state. A small recent
window can retain an unresolved lookup or error without resending every previous ticket.

No mandatory re-observation. If the assignment tool's receipt is sufficient, use it.
If the goal requires independently confirmed assignment, expose a lookup/verification
tool and let the authored decision contract offer it.
