# Full-video script review

Reviewed 2026-10-08 against current primary documentation and the local V1 contracts. This is a production script for an illustrative explanatory film, not evidence of live ticket execution or model reliability.

## Narrative and timing

The order follows the user's correction: why and audience → human intuition → model mapping → machinery otherwise built → Pi and Turbo → high-level example → ownership → connection points → late small pseudocode → scoped help/state → payoff. No Pi, Turbo, author taxonomy or code is assumed at the opening.

The narration has **974 words** using Unicode-aware word tokens, **12 scenes**, and **36 paragraphs**. Scene minimums sum to **425 seconds / 7:05**; the target is 420 seconds and the requested range is 6–8 minutes. The final production duration must come from measured Kokoro paragraph audio plus deliberate reading/animation holds, not a guessed speaking rate. No dialogue is truncated to force a duration.

The film works through one real-world T42 example: a disputed May invoice with two alleged ₹2,499 debits and a screenshot reference. The customer message is shown in full; narration paraphrases it. Author-prepared, verified payment facts support the routine classification. A later follow-up on T42 introduces checkout failure and service access loss. Keep the original routine receipt as history and require a distinct outcome for the new request; an old assignment does not finish the follow-up. News appears briefly as an independent reuse cue, never as part of the ticket architecture.

## Primary-source checks

| Claim / treatment | Source | Review result |
| --- | --- | --- |
| Automatic recognition vs deliberate effort; skilled intuition requires learnable patterns and effective feedback. | [Kahneman & Klein, Conditions for Intuitive Expertise, 2009](https://bear.warrington.ufl.edu/brenner/mar7588/Papers/kahneman-klein-2009.pdf), especially pp. 519–520 and 524. | Support trainee and supervisor are an authored illustration of the learning conditions. No literal biological module claim. The supervisor supplies human feedback; Pi is absent. |
| Jev consumes supplied state and typed questions rather than freeform chat. | [TypeSafe Introduction](https://docs.typesafe.ai/introduction) | Correct. The narration distinguishes user configuration/evaluation from weight training. It does not promise application-specific learning from runtime feedback. |
| Choice returns a selected option, option probabilities and confidence. | [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice) | Correct. Ticket routes are illustrative application criteria. No displayed numeric output is a captured inference. |
| Noul is probability of yes, without a separate confidence field. | [TypeSafe Noul](https://docs.typesafe.ai/primitives/noul) | Correct; put the absent separate confidence field in the visual label. Pi's normalized classifier contract may expose a bool question rather than raw TypeSafe Noul; no raw Noul request code appears. |
| Confidence summarizes answer concentration; it does not prove correctness. | [TypeSafe Confidence](https://docs.typesafe.ai/confidence) | No formula or numerical threshold is invented. The caveat is our epistemic interpretation of the documented statistic: concentration cannot establish real-world correctness. Help is an authored choice, not a universal confidence-only rule. |
| Pi exposes classifier models natively to extension code and model-callable codemode scripts. Classifier availability alone does not change the driver. | [Pi Models](https://pi.dev/docs/latest/models) | Correct. `ctx.modelRegistry.classify()` is the extension seam. Ordinary Pi model-to-tool continuation is shown briefly before Turbo. |
| A selectable virtual model dispatches to a physical provider model; it is not itself a new classifier. | [Pi Virtual Models](https://pi.dev/docs/latest/virtual-models), [Pi Custom Providers](https://pi.dev/docs/latest/custom-provider) | Correct. Local path is `turbo/auto` → Turbo chat-shaped provider → native classify. Do not draw the virtual model directly selecting a classifier as a chat model. |
| Extension registration, lifecycle hooks, tools, session entries and extension communication are native Pi facilities. | [Pi Extensions](https://pi.dev/docs/latest/extensions) | Correct. Local factory registration and session-resource lifecycle align with the documented extension seams. No second System One loop is implied. |
| Existing extensions and connected MCP tools remain available. Nested calls go through Pi hooks. | [Pi MCP](https://pi.dev/docs/latest/mcp), [Pi Extensions](https://pi.dev/docs/latest/extensions) | Correct as a compositional design claim. Exposure, bindings and permission gates still matter. This is not proof that every possible extension combination has been tested, or that Turbo converts every installed tool into a model action. |
| Pi sessions retain records. | [Pi SDK](https://pi.dev/docs/latest/sdk), [Pi Sessions](https://pi.dev/docs/latest/sessions) | Correct. Persisted history is distinct from business-state retention and from automatic crash continuation. |
| Durable tool intent/replay and durable child conversations belong to Pi Durable. | [Pi Durable](https://earendil.com/posts/pi-durable/) | The film does not claim those mechanisms are implemented by the current coding-agent extension. Persistent records are presented as a foundation; automatic crash continuation remains separate work. |

## Local implementation checks

Read [ARCHITECTURE.md](../../../ARCHITECTURE.md), [V1 implementation](../../v1-implementation.md), and [contracts.ts](../../../src/contracts.ts). These are the authority for local Turbo behavior; the movie is not runtime acceptance evidence.

- `registerSystem1`, `prepareTurn`, the paired `{ request, resolve }` return, and `tool / consult / final` decisions are current local contracts.
- Author functions/data such as `currentTicket`, `relevantResults`, `myRoutingCriteria`, `mapDecision`, `validNext`, `myFinal`, `myPiTools`, and `myExactReadGrants` are schematic application code. They are not shipped Turbo conveniences.
- `myPiTools` is a list of already registered or exposed native tool names. Business tool registration and implementation belong to Pi integrations. The code card does not secretly implement assignment.
- Jev is text/state-only in this example. `bank-debits.png` is an attachment reference, not direct image understanding. Relevant verified payment facts are prepared by the application, using its source tools or state. The illustrative film does not claim that a screenshot was read or that a refund was executed.
- Exact tool arguments follow the local decision contract. The example intentionally shows only the payments mapping; real applications need other routes, validation, and domain evaluation.
- Receipt selection and final checks apply to the current request/work unit. Retaining the ticket ID across a customer follow-up does not make an older receipt proof of the new outcome.
- Questions are prepared from author-selected ticket, policy and evidence. Helper availability is passed explicitly through `ctx.capabilities` so the author can omit unavailable actions.
- System Two is enabled/configured by the operator. The author supplies subtask goal, inputs, completion condition and explicit tool argument grants. Operator ceiling, author scope, and native availability/hooks remain separate controls.
- Implemented helper transport is a scoped native `pi-agent-core` Agent. It has a supplied brief and native tool loop; calls are forwarded through parent Pi execution. It is not a same-session model switch or separately durable `AgentSession`.
- Findings and actual tool outcomes return to preparation. The application chooses what System One sees next. System Two has no direct ungranted assignment route in the diagram.
- V1 business state and model context remain author-managed. Pi owns session history; Turbo records control/judgment/consultation data. Overflow, automatic retention, migrations, and other edge cases stay outside the film.
- Current unfinished attempts restore as interrupted rather than replaying stored calls. No narration implies automatic resumption or external effect rollback.

## Rendering requirements and uncertainties

- Introduce the ownership legend only after the ordinary-language need for a harness has been explained. Preserve cyan System One, amber System Two, blue application logic, purple Turbo and green Pi meanings.
- Motion must show changed information and control, especially the returned-evidence packet arriving before the next judgment.
- No code before scene 10. Its three cards each contain at most six lines. Scene 11 may show one scoped-consultation card and one evidence-selection card sequentially.
- Label ticket execution, model outputs and cost/latency pathways as illustrative. No latency, cost, accuracy, delivery or durability benchmark was collected for this film.
- Kokoro pronunciation of Jev/Noul and the letter-spelled LLM/MCP/SOS must be auditioned after generation. Text uses spoken letter forms for acronyms; visible labels should use normal acronyms.
- Native API/docs are current at review time; the local implementation is explicitly Pi 1.0.4. The film can state the verified seams without asserting an unqualified future-version compatibility guarantee.
