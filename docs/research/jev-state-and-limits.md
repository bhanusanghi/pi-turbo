# Jev state, evidence, and request limits

Research checked **2026-10-07** against live first-party TypeSafe documentation, starting at its [documentation
index](https://docs.typesafe.ai/llms.txt). This is source research and a proposed application pattern. No model call, credentials, production
data, or empirical accuracy test was used.

## What Jev receives and remembers

`state` means the material for **this evaluation**: text or structured JSON with named records, relationships, policies, and evidence. Several
related records can form one state. JSON is an input representation, not an automatically maintained database. Related evidence belongs together
when the question compares it. [State](https://docs.typesafe.ai/concepts/state)

Treat evaluations as self-contained. The documented request contains `state`, `questions`, and `model`; the SDK sends that request without
appending previous answers. No conversation/session-memory handle is documented. Therefore the application must store earlier evidence and
include it again when needed. This is an inference about the evaluation contract, **not** a claim about server logging or data retention. [HTTP
contract](https://docs.typesafe.ai/api), [official SDK implementation](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/client.ts)

The HTTP guide lists string/object/array inputs. SDK types also permit `null` and nested JSON scalars, including numbers and booleans. Use
meaningful named text and ordinary JSON fields; the model is text-only, not a native image/audio processor. [SDK
types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts), [state formats](https://docs.typesafe.ai/concepts/state)

## Outputs and dependent stages

| Primitive | Output the author can use |
| --- | --- |
| Choice | One supplied option, its distribution, confidence |
| Noul | Probability of yes; no separate confidence field |
| Score | Position on authored ordered levels, distribution, confidence |

These are typed judgments. Jev does not generate an alert paragraph, a novel summary, or its own explanation. Templates can render known facts; a
generative helper can propose text or extract candidate facts. Extraction still needs source references and verification. [System
One](https://docs.typesafe.ai/concepts/system-one), [generation limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

All questions in one request see the same state, but none sees another question's answer. Batch independent judgments. When answer A is needed to
retrieve sources, build state B, or choose B's options, issue a second request. Do not refer to “the answer above” inside another question in the
same call. Question IDs identify results in code; the model does not see those IDs. [Question composition](https://docs.typesafe.ai/primitives)

Choice/Score confidence measures concentration of the answer distribution; it is not an independent probability that the workflow, source, or
real-world claim is correct. Calibration concerns groups of predictions. Thresholds require domain evaluation, and high confidence does not
establish evidence completeness. [Confidence](https://docs.typesafe.ai/confidence), [calibration](https://docs.typesafe.ai/concepts/system-one)

## Documented limits and measurement

The live [Models page](https://docs.typesafe.ai/models) currently documents:

| Item | Published value or constraint |
| --- | --- |
| Version | `jev-1.13.0` |
| Aliases | `jev-latest` and `jev-preview` both currently resolve to it |
| Whole request | **64k tokens:** state plus all questions combined |
| Per-question context | **32k tokens:** state plus the longest question |
| Rate | 100K tokens/second and 80 requests/second; explicitly subject to change |

Both context constraints apply. Splitting questions may relieve the 64k constraint but cannot fix a state-plus-question that already exceeds 32k.
Instructions and answer criteria belong to the question budget. The published `k` notation does not specify whether its integer expansion is
decimal or binary. Log the response's resolved model version; pin it for repeatable evaluations because aliases can move.

The [HTTP reference](https://docs.typesafe.ai/api) additionally specifies a maximum of **255 Choice options**, **10 Score levels** (at least two
recommended), and response `usage.input_tokens` / `usage.output_tokens`. The JavaScript client requires nonempty questions and at least two Score
levels. [JavaScript client contract](https://docs.typesafe.ai/sdk/javascript/api/classes/TypeSafeClient)

**Measurement gap:** the reviewed docs/client expose actual usage after evaluation, but no documented exact preflight tokenizer/count endpoint,
serialization-overhead formula, or per-question token breakdown. Model-list metadata is name, description, and release date; it does not
advertise numeric context limits. No independent maximum question count or HTTP-body byte limit was found in these sources. Absence from this
review is not proof no server limit exists. [SDK client](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/client.ts), [SDK
request/usage/model types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts)

Proposed Turbo implication: measure encoded bytes exactly; label token estimates as estimates until the selected adapter has a verified counter.
Keep configurable headroom, include questions/criteria and adapter overhead in the report, and record provider usage after success. Do not equate
bytes, characters, or Pi transcript estimates with Jev token counts. Direct TypeSafe requests and Pi classifier normalization are separate
contracts requiring separate inspection.

On excess input, rebuild under the author's explicit projection policy and recheck both constraints. Preserve evidence needed for the next
judgment. If meaningful input still cannot fit, return a structured over-budget outcome; do not silently truncate, treat it as “irrelevant,” or
promise an unlimited helper context.

The HTTP reference documents validation errors as `422`, rate limits as `429`, and overload as `529`; it does **not** specify the exact
status/body for context overflow. Handle observed provider errors without inventing that classification. SDK retries and per-attempt timeouts
also need a runtime-owned overall deadline and cancellation/accounting policy. [HTTP errors](https://docs.typesafe.ai/api), [SDK request
options](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts)

## Validation boundary

Validate context projection, thresholds and independent semantic outcomes for each consuming application. These source notes do not prove live model quality or end-to-end latency/cost.
