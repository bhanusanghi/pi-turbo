# Repository guidance

## Scope and sibling repositories

This repository owns the reusable Pi Turbo extension, public package contracts,
System 1 decision translation, bounded System 2 consultation, and native runtime tests.

- `../portfolio-monitor` (`bhanusanghi/portfolio-monitor`) owns the application API,
  source adapters, credentials, holdings, evaluation recipe, product persistence,
  scheduling, notification routing, and delivery.
- `../raven` (`bhanusanghi/raven`) owns the browser frontend and design prototype.
  It consumes the backend's HTTP contracts.
- Keep product terminology and policies in the backend. When changing a public Turbo
  contract, inspect its application callers and the backend's
  `docs/turbo-development.md`. Verify the consumer against the built package.
- Use Module, Interface, Implementation, Seam, Adapter, Depth, Leverage, and Locality
  consistently. An ownership boundary names who controls state or policy; a seam
  names where an implementation can be substituted.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing the controller,
model inputs, action mappings, state, history, helper availability, or compaction.
It separates agreed ownership rules from draft interfaces.

- Pi owns the session and tool execution. Agent authors register tools through Pi.
- Authors supply all Jev-visible goals, state, questions, criteria, action descriptions,
  argument bindings, result interpretation, and consultation policies.
- The runtime carries authored decisions into Pi and enforces mechanical constraints.
- System 2 consultation returns its result to System 1. Helper availability and host
  permissions remain explicit.
- Product instructions and evidence selection stay authored by the application.
  Tool authority comes from executable grants, never instruction text.
- Native recovery memos are transient. Retain generic decision evidence through
  Pi Durable records for developer debugging and product improvement. Applications own
  product cases, policy snapshots, trace references, and access to developer diagnostics.
  Raw prompts, model answers, and tool traces are not end-user product features.
- Keep compatible runtime changes independently reviewable before consumer updates.
  Update the public contract and compatibility evidence together.
- Keep executable behavior, proposed contracts, pseudocode, and unverified behavior
  distinguished in documentation.
- For System 1 changes, show the next judgment, input rationale, before/after meaning,
  execution evidence, and missing model validation. A size limit alone is not efficiency.
- Tests should execute production paths and assert observable behavior. Do not replace
  missing implementation with hardcoded-success or test-shaped placeholders.

For local checks and native Pi lifecycle contracts, see [development](docs/development.md).
For package metadata, publishing, and maintenance, see [releasing](docs/releasing.md).
