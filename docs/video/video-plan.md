# Video plan: From repeated decisions to completed work

Revised **2026-10-08**. Target: **7:30** within the requested 6–8 minutes.
Audience: developers building classification and broader System One/LLM applications.
Some know Pi; none are expected to know our terminology at the opening.
One worked example: ticket triage, with routine and ambiguous tickets in the same stream.

[Interactive storyboard](storyboard.html) · [Scene data](scenes.json) ·
[Late architecture Manim starter](turbo_scene.py) · [Preview builder](build_storyboard.py).

## The story contract

**Why:** repeated judgments need to become completed actions, with investigation available.
**Who:** developers building workflows with a useful, bounded decision space.
**Why reuse this:** avoid rebuilding model/tool/session/helper machinery for each product.
**What they get:** System One as the decision driver, optional scoped System Two,
and Pi’s existing execution foundation and persistent session records. **Keep using
other Pi extensions and any MCP server supported by Pi alongside Turbo.**
**What they bring:** domain policy, relevant business state, questions, tool bindings,
and evaluation of the resulting workflow.

The video earns each new name before using it. Human intuition is explained independently
of software. The high-level flow comes before responsibility boundaries. Pseudocode comes
last and shows the functions a developer actually supplies, not an input-submit hook.

Turbo V1 is locally implemented; this ticket companion is explanatory pseudocode, not
a runnable integration. A durable-agent foundation is the product vision. Current V1
persists records and marks interrupted work; automatic crash continuation is not provided.
Live model accuracy, assignment delivery, cost and latency have not been demonstrated by
this storyboard. Keep those qualifications in producer notes; do not teach recovery edge
cases in the main film.

## Progressive disclosure and visual grammar

| First introduce | Only then reveal |
| --- | --- |
| Repeated decisions → useful outcomes | Who needs the system; what they want to reuse |
| Familiar recognition and deliberate effort | Human practice and supervisor feedback |
| A trained model returning typed judgments | Choice / Noul / confidence; reasoning when needed |
| Agent machinery developers otherwise build | Pi as harness, Turbo as extension |
| High-level input / judgment / action flow | Helper branch, then its return to System One |
| Developer / Turbo / Pi responsibilities | Models, tool integration, state ownership |
| Architecture and capabilities | Small integration functions, one at a time |

- Dark canvas, simple geometry and persistent objects. Motion explains a change in
  meaning; it does not merely decorate a slide. Original visuals and narration.
- Early frames use ordinary-language labels and no ownership legend. The human
  scene uses cyan familiar recognition and amber deliberate thought. Supervisor feedback
  remains human. No Pi or Turbo in that analogy.
- Introduce blue developer logic, purple Turbo and green Pi when naming the system
  at **3:15**. Cyan System One and amber System Two retain their meanings.
- At most three main objects initially. Reveal the routine route before the helper.
- **No on-screen code before 5:30.** The final section shows 4–6-line functions and
  explicitly distinguishes your functions from actual Turbo/Pi interface names.
- Keep the ticket and exact ID consistent. An answer is a judgment; only an actual tool
  result proves execution. Illustrative probabilities and routes are labeled.
- Cost and latency are a motivation, not measured evidence. Show the shorter routine
  route versus deeper investigation, without stopwatch claims or invented benchmarks.

## Timing and progressive disclosure

<!-- timeline:start -->

| Time | Scene | Reveal |
| --- | --- | --- |
| 0:00–0:35 | The problem | Tickets keep arriving. Routine cases need action; unusual cases need investigation. |
| 0:35–1:05 | Who + value | Keep your domain logic. Reuse the machinery that carries it to an outcome. |
| 1:05–1:50 | Human intuition | Kahneman: automatic recognition and deliberate effort. |
| 1:50–2:35 | AI models | A focused model returns a usable decision. A reasoning model can investigate. |
| 2:35–3:15 | Build burden | Even a useful classifier does not execute a complete workflow by itself. |
| 3:15–3:50 | Meet the system | Turbo works alongside your other Pi extensions and any MCP server connected through Pi. |
| 3:50–4:35 | High-level flow | System One chooses the next step. Deeper help returns to that decision flow. |
| 4:35–5:05 | Ownership | Your code defines meaning. Turbo coordinates. Pi executes and records. |
| 5:05–5:30 | Connect first | Connect through Pi; map existing tools into your workflow and scoped helper. |
| 5:30–6:35 | Your functions | Small functions connect your domain logic to the reusable agent. |
| 6:35–7:10 | Help + state | Your policy defines the investigation and what evidence stays in state. |
| 7:10–7:30 | What you get | A reusable foundation for judgment-driven workflows, with deliberate help available. |

<!-- timeline:end -->

## Narration and visual beats

<!-- script:start -->

Each early scene is visual only. Pseudocode appears in scenes 10–11, after the architecture.

### 01. Repeated decisions should become completed work (0:00–0:35)

**Narration**

Every day, another stream of decisions arrives. A ticket needs the right team. A news item might matter to a position. A document might need review. You want more than a classification: you want the work carried through to a result. Most cases follow familiar patterns. Some need investigation. How do you build a system that handles both, without rebuilding the machinery around every new application?

**Visual beats**

A label is useful. A completed action is the goal.

**Producer note**

Begin with a concrete developer problem and a completed outcome. No platform names, role taxonomy or code yet.

### 02. For developers turning judgment into workflows (0:35–1:05)

**Narration**

This is for developers building applications where judgment leads to action: routing tickets, filtering relevant information, or checking whether something needs attention. You still define what a good decision means. What you should be able to reuse is the system that calls models, runs tools, keeps records, and handles requests for deeper help. The goal is to jump-start a persistent agent around your useful logic.

**Visual beats**

One product’s rules. Shared execution machinery.

**Producer note**

Other domains are brief audience cues, not additional worked examples. “Persistent” does not promise automatic crash replay.

### 03. Why familiar decisions can become fast (1:05–1:50)

**Narration**

Daniel Kahneman described two modes of thinking. System One is automatic: a familiar word or pattern comes to mind quickly. System Two takes deliberate effort: working through an unfamiliar problem. Imagine a new support colleague learning to route tickets. At first, they study the policy and reason through each case. With practice and reliable supervisor feedback, familiar patterns become easier to recognize. This works when the environment has patterns that can actually be learned. The lesson is not to trust every intuition. It is to recognize familiar cases while keeping deliberate thought available for unfamiliar ones.

**Visual beats**

Learnable patterns + repeated practice + reliable feedback

**Producer note**

Human teaching analogy only. Feedback is from a human supervisor, never Pi. Practice needs learnable regularities and reliable feedback; no literal brain-module claim.

### 04. The AI analogy: a judgment, or a deeper investigation (1:50–2:35)

**Narration**

A System One model such as Jev gives us a related building block: supplied information goes in, a typed judgment comes out. A Choice can pick payments, technical, or SOS. A Noul gives a probability for a yes-or-no question. Choice confidence describes the concentration of the answer; it does not prove correctness. A System Two language model can instead plan, investigate, and generate a response. The opportunity is to use the focused judgment on the routine path, and spend on deeper reasoning when needed. Here Jev is already trained. We configure and evaluate its inputs and decision criteria; we are not training its weights.

**Visual beats**

Target: lower routine cost and latency; evaluate on your workload.

**Producer note**

All displayed values are illustrative. Choice probabilities .94/.04/.02 give confidence .91 for three choices under the documented normalization. Noul has no separate confidence. Shorter route is schematic, not a latency benchmark; no universal speed or cost guarantee.

### 05. Your product needs rules. An agent needs machinery. (2:35–3:15)

**Narration**

Suppose you already have a good way to classify tickets. To make it an agent, you still need to execute the assignment, feed results into the next decision, maintain a session, and coordinate a helper that may call several tools. You can build all of that yourself. But then each application carries another version of the same plumbing. We want a reusable foundation, while your rules, business state, and tool bindings remain under your control. The classifier supplies judgment. The surrounding system carries it into work.

**Visual beats**

Domain logic is product-specific. Execution machinery can be shared.

**Producer note**

Define the ordinary-language need for a harness before naming Pi or Turbo. Custom construction remains valid for needs outside this bounded decision model.

### 06. Pi supplies the harness. Turbo makes judgment the driver. (3:15–3:50)

**Narration**

That foundation is Pi: a mature agent harness with model connections, tool execution, extension hooks, and session records. Turbo is one extension on that harness. You can keep using other Pi extensions and connect any MCP server supported by Pi. Their tools and hooks remain part of the same environment. Pi already supports classifiers such as Jev. Turbo adds the orchestration that lets a typed judgment select the next step, with optional System Two consultation. You bring the product logic and map the available capabilities into your workflow.

**Visual beats**

Keep your Pi extensions and MCP integrations. Add Turbo’s decision flow.

**Producer note**

First introduction of Pi/Turbo and ownership colors. Current implementation uses native classifier access and a native Agent helper, not a same-session System Two model switch. The composition callout shows other extensions and connected MCP servers feeding the shared Pi environment. Workflow use requires explicit tool exposure, bindings and permissions; this is not a claim that every possible extension combination has been tested.

### 07. The whole flow, before any code (3:50–4:35)

**Narration**

Here is the whole idea. A ticket arrives. Your application supplies the relevant facts and policy. System One selects a next step. A clear payment issue can become an assignment, executed through Pi, followed by a final response based on the result. Now change the ticket: “My payment failed, and the service is down.” The correct route may need evidence. If enabled, System One can request a System Two investigation. That helper checks the permitted tools and returns its findings. The main workflow then asks System One what to do with that evidence. Deeper reasoning is available without becoming the default driver of every case.

**Visual beats**

Routine: assign → actual receipt → finish. Unclear: investigate → judge again.

**Producer note**

Reveal routine route first, then helper and return. Same ticket stream, independent routine/ambiguous variants. A configured response can be templated; Jev does not generate freeform replies.

### 08. Three responsibilities; clear integration boundaries (4:35–5:05)

**Narration**

Zoom in one level. Your functions decide what the model sees, what questions it answers, and what each answer means. Turbo calls those functions, obtains the typed judgment, and routes the resulting tool, consultation, or final decision. Pi owns the session and tool execution. This separation is what makes the extension reusable: ticket categories belong to the ticket application, not Turbo. A news application supplies different state and mappings to the same boundaries. Business state is also yours; you choose the facts carried into each decision.

**Visual beats**

Native path: virtual selection → provider → Pi classifier. Pi supplies the execution lifecycle.

**Producer note**

Source-grounded responsibility diagram, not an observed live trace. Actual adapter: turbo/auto virtual selection → Turbo custom provider → native ctx.modelRegistry.classify. Isolated native Pi Agent for System Two; its scoped wrappers re-enter parent executeTool and hooks.

### 09. Reuse your Pi extensions and MCP tools (5:05–5:30)

**Narration**

Choose a System One classifier and, if you want deeper help, an authenticated System Two model. Keep using your other Pi extensions and MCP connections. Expose their business tools through Pi: reading an order, checking service status, or assigning a ticket. Map the tools your workflow needs, and grant the helper its subset. Turbo reuses Pi’s execution and hooks; your policy still decides when each capability is used.

**Visual beats**

Other Pi extensions + any Pi-compatible MCP → shared tools → your workflow

**Producer note**

MCP tool exposure must be explicit; no automatic conversion of all installed tools. Model references and credentials use Pi. Operator ceiling plus per-subtask grant determine helper access.

### 10. The code you bring: prepare, ask, map (5:30–6:35)

**Narration**

Now the code. Start with a function that prepares the next decision. It loads the current ticket, your routing policy, and relevant results. A second function defines the question and criteria: payments for a charge issue, technical for a product fault, SOS for your urgent-incident rules, and investigation when evidence is needed and the helper is available. The resolver maps an answer to an exact action. Payments means calling your registered assignment tool with this ticket ID and this team. Register those functions through Turbo’s integration interface. Turbo handles the repeated prepare, judge, and resolve cycle; Pi executes the returned tool. When the actual tool result confirms assignment, your preparation function can finish with a simple response. You write the meaning and the bindings, rather than the machinery around them.

**Visual beats**

The seam returns an action description. Pi performs the action.

**Producer note**

Explanatory pseudocode only; not a runnable ticket companion. prepareTurn, registerSystem1, request shape, answers.next.choice, and decision objects match current contracts. stateFor, questionsFor, resolve, validNext, confirmedAssignment, toolResult and myPiTools are developer-owned functions/data. Add validation and non-payment mappings in the real integration. Early scenes deliberately contain no code.

**Prepare — pseudocode**

```text
prepareTurn(ctx):
  state = stateFor(ctx)
  if confirmedAssignment(state): return myFinal(state)
  return { request: questionsFor(state, ctx.capabilities),
           resolve: result => resolve(state, result) }
```

**State — pseudocode**

```text
stateFor(ctx):
  return { ticket: currentTicket(ctx),
           policy: myRoutingPolicy,
           evidence: relevantResults(ctx) }
```

**Question — pseudocode**

```text
questionsFor(state, capabilities):
  return { state, questions: { next: {
    type: "choice", instructions: "Choose next step",
    criteria: myCriteria(state.policy, capabilities)
  } } }
```

**Criteria — pseudocode**

```text
payments: "Charge/refund issue; no SOS"
technical: "Product fault; no SOS"
sos: "Urgent incident under our policy"
ask_user: "Missing customer information"
if helper enabled:
  investigate: "Need external verification"
```

**Map answer — pseudocode**

```text
resolve(state, result):
  answer = validNext(result.answers.next)
  if answer == "payments":
    return { kind: "tool", name: "assign_ticket",
             args: { ticketId: state.ticket.id,
                     team: "payments" } }
```

**Register — pseudocode**

```text
registerSystem1(pi, {
  id: "tickets", revision: "1",
  tools: myPiTools,
  prepareTurn
})
// Business tools are registered/connected through Pi.
```

### 11. Deeper help gets a subtask, then returns facts (6:35–7:10)

**Narration**

For the ambiguous ticket, your resolver returns a consultation: a goal, supplied facts, a completion condition, and permitted tools with explicit arguments. The built-in helper can take several steps within that scope. Its findings and actual tool results return to your preparation function. You decide which facts to retain and include in the next judgment. Pi retains session history; Turbo tracks the attempt and consultation; your application manages business state. This is enough to build a continuing workflow without expecting the classifier to remember facts it was never given.

**Visual beats**

Session history: Pi · control record: Turbo · business facts: your code

**Producer note**

Helper runs as an isolated native Pi Agent; tool wrappers use parent execution/hooks. Configured operator tool ceiling intersects author subtask grants and host permission checks. V1 business state/context stay developer-managed. On-screen read_* names are illustrative, not shipped capabilities.

**Consult — pseudocode**

```text
return { kind: "consult", request: {
  goal: "Determine whether T42 is payment or outage",
  inputs: { ticket: state.ticket },
  doneWhen: "Return supported findings + uncertainties",
  tools: myExactReadGrants(state.ticket)
} }
```

**Tool scope — pseudocode**

```text
myExactReadGrants(ticket):
  return [
    { name: "read_order",
      arguments: [{ id: ticket.orderId }] },
    { name: "read_service_status", arguments: [{}] }
  ]
```

**Remember — pseudocode**

```text
relevantResults(ctx):
  return selectRelevant(
    myStoredFacts(ctx.pi),
    actualToolResults(ctx.pi),
    ctx.consultation
  )
```

### 12. Bring your logic. Reuse the agent machinery. (7:10–7:30)

**Narration**

You bring the rules, relevant state, and bindings to your tools. Turbo brings the judgment-driven flow and optional deeper help. Pi supplies execution and persistent records, alongside your existing extensions and MCP tools. Start with one bounded workflow, evaluate it on real cases, and spend your effort on what makes your application useful.

**Visual beats**

Your logic + existing Pi extensions + MCP tools + Turbo’s decision flow

**Producer note**

Closing value statement. No live speed, cost, correctness or automatic recovery promise. Future domains are reuse cues, not combined application architecture.

<!-- script:end -->

## Integration reference for the producer

The public seam is `registerSystem1(pi, { id, revision, tools, prepareTurn })`.
`prepareTurn` returns the classifier request and a resolver paired with the same snapshot,
or a known final decision. The resolver returns `tool`, `consult`, or `final`.
The helper uses a scoped native Pi Agent and returns a `HelpResult` to preparation.

| Responsibility | Supplies / does |
| --- | --- |
| User configuration | Integration, classifier reference, optional authenticated helper model, tool ceiling and work limits |
| Developer’s functions | State projection, questions/criteria, answer interpretation, exact action arguments, subtask policy, retained evidence, final response |
| Turbo extension | Native virtual selection/provider adapter, prepare/judge/resolve orchestration, structural validation and limits, consultation records |
| Pi | Session, native classifier access, shared extension/MCP tool registration and exposure, execution/hooks/results; native Agent primitive for scoped helper |

The late lower-level diagram can briefly label the native path:
`turbo/auto → Turbo provider → ctx.modelRegistry.classify`.
This is a current source call path, not a live execution recording. The helper is isolated;
it does not switch the parent session to a different chat model.

State stays author-managed in V1. `relevantResults` means deliberately selecting actual
business facts from your native entries or external storage, tool receipts and the latest
consultation. It is not an automatic summary, memory manager or business-state reducer.
Questions must only offer actions with valid bindings and available capabilities.
Other Pi extensions keep their hooks and capabilities in the shared environment. MCP
servers connect through Pi normally; expose and map their tools explicitly for this
workflow, and grant only the needed subset to System Two. Turbo does not maintain a
separate MCP client or require rebuilding these tools. Composition is the design;
universal compatibility testing of arbitrary extension combinations is not claimed.

Edit `scenes.json`, then run `python3 docs/video/build_storyboard.py` to refresh the
embedded preview, timing table and narration. The HTML works offline without fetch.

## How to produce the video

1. **Lock this story and words first.** Read the narration aloud and record scratch
   audio scene by scene. The times above are an edit budget, not measured speech
   timing; leave pauses for a viewer to inspect code. Shorten words before speeding up.
2. **Review the storyboard.** Open `storyboard.html`, select scenes, and reveal one relationship at a time.
   Code is visible only in the final integration section. This is a browser animatic/storyboard, not a finished rendered film.
   Verify the central ticket, helper-return arrow and ownership labels before polishing.
3. **Choose one animation engine.** Recommend **Manim Community** for this project:
   Python scenes, deterministic diagrams, text and transforms, with documented rendering.
   Grant Sanderson's original Manim/ManimGL is a different distribution; use one
   distribution's examples consistently. Follow official macOS installation guidance.
4. **Render the core loop first.** `turbo_scene.py` is a short starter for the decision,
   tool and helper-return motif. It uses plain `Text`, so this starter does not need
   LaTeX. Its syntax was checked; rendering needs Manim installed in a separate environment.
5. **Expand one scene at a time.** Build the 12 shots around a common palette and
   reusable ticket, state, model, tool and receipt objects. Freeze rough scene duration
   against scratch narration; produce low-quality clips before final rendering.
6. **Record final narration.** Use your own clear voice, scene-separated WAV files.
   Align each important phrase with its object reveal. Quiet pauses are useful; music
   is optional. The intended style comes from explanation and motion, not voice imitation.
7. **Assemble and caption.** Put narration and scene clips on an editor timeline,
   trim to 6–8 minutes, and export captions. Hold complicated code cards longer.
   If actual terminal footage is added, first implement a ticket companion with real
   Adapters and obtain test receipts; otherwise label the animated trace illustrative.
8. **Final export and review.** Render at 1920×1080, 30 fps; inspect the result at
   ordinary laptop and phone playback sizes. Check code legibility, sound, captions,
   model/helper return, ownership, probabilities and every performance/durability claim.

Once the isolated Manim Community environment is installed, from the repository root:

```sh
# Low-quality review: 480p, 15 fps
python -m manim -ql docs/video/turbo_scene.py TurboLoopPreview

# Final scene render: 1080p, 60 fps by quality preset, overridden to 30 fps
python -m manim -qh --fps 30 docs/video/turbo_scene.py TurboLoopPreview
```

Activate the selected environment so `python` refers to it. Manim writes its media
under `media/` unless configured otherwise; direct output to a separate working
folder during production. These are instructions, not a claim that a movie was rendered.
The starter has schematic animation durations and no narration; it is not the 7:30 film.

## Source and claim ledger

Pi, cognition and animation sources checked **2026-10-07**; TypeSafe model/concept sources refreshed **2026-10-08**. Store sources here rather than cluttering the film.
Use brief citations on relevant frames and complete links in the video description.

| Topic | Primary source | Treatment |
| --- | --- | --- |
| Fast/effortful thinking; expert intuition | [Kahneman & Klein, 2009](https://bear.warrington.ufl.edu/brenner/mar7588/Papers/kahneman-klein-2009.pdf), DOI 10.1037/a0016755 | Cognitive framing and conditions for learning; support trainee is our fictional analogy. |
| Choice, Noul, Score | [TypeSafe primitives](https://docs.typesafe.ai/primitives) | Typed output, independence, supplied options; avoid generated reasoning claims. |
| System One and model economics | [TypeSafe System One](https://docs.typesafe.ai/concepts/system-one), [models](https://docs.typesafe.ai/models) | Already-trained typed judgment; no customer fine-tuning. Vendor lists Jev input pricing at $0.042 per million tokens as of Oct 8. Keep changing prices in producer notes. API rate limits are not per-request latency measurements; no numeric performance claim in the film. |
| Confidence | [TypeSafe confidence](https://docs.typesafe.ai/confidence) | Choice concentration; Noul is P(yes), with no separate confidence. Example values are invented for illustration. |
| Pi loop | [How Pi works](https://pi.dev/docs/latest/how-pi-works) | Brief native execution/session refresher. |
| Native classifiers | [Pi models](https://pi.dev/docs/latest/models#use-classifier-models) | Jev providers, codemode access, direct extension `ctx.modelRegistry.classify`; unavailable as `/model` chat choices. |
| Pi extension composition | [Pi extensions](https://pi.dev/docs/latest/extensions) | Factory/tool/hooks; our companion uses `registerSystem1`. |
| MCP composition | [Pi MCP](https://pi.dev/docs/latest/mcp) | Exposure/active-tool configuration matters; narrow wrappers are allowed. |
| Current Turbo behavior | [Implementation](../v1-implementation.md), [contracts](../../src/contracts.ts), [extension](../../src/extension.ts), [helper](../../src/helpers/system2.ts) | Local implementation and source call path; ticket example remains pseudocode and live model/delivery are unverified. |
| Persistent versus automatically resumable work | [Pi Durable applicability](../research/pi-durable-applicability.md) and [remaining validation](../implementation-plan.md) | Durability vision is not an automatic continuation guarantee for current coding-agent V1. |
| Animation approach | [3Blue1Brown's Manim demo](https://www.3blue1brown.com/lessons/manim-demo/) | Reference for explanatory visual workflow; original visual assets and narration. |
| Rendering | [Manim Community quickstart](https://docs.manim.community/en/stable/tutorials/quickstart.html), [installation](https://docs.manim.community/en/stable/installation/uv.html), [output settings](https://docs.manim.community/en/stable/tutorials/output_and_config.html) | Manim Community 0.21.0 documentation reviewed; starter rendering not executed. |

**Excluded from this film:** context overflow, compaction, retry rules, crash-replay
mechanics, provider implementation internals, publication/setup troubleshooting,
multiple domain walkthroughs and claims of measured speed/cost improvements.
