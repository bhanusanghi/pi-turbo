# Repository guidance

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing the controller,
model inputs, action mappings, state, history, helper availability, or compaction.
It separates agreed ownership rules from draft interfaces.

- Pi owns the session and tool execution. Agent authors register tools through Pi.
- Authors supply all Jev-visible goals, state, questions, criteria, action descriptions,
  argument bindings, result interpretation, and consultation policies.
- The runtime carries authored decisions into Pi and enforces mechanical constraints.
- System 2 consultation returns its result to System 1. Helper availability and host
  permissions remain explicit.
- Keep executable behavior, proposed contracts, pseudocode, and unverified behavior
  distinguished in documentation.
- For System 1 changes, show the next judgment, input rationale, before/after meaning,
  execution evidence, and missing model validation. A size limit alone is not efficiency.
- Tests should execute production paths and assert observable behavior. Do not replace
  missing implementation with hardcoded-success or test-shaped placeholders.

For local checks and native Pi lifecycle contracts, see [development](docs/development.md).
For package metadata, publishing, and maintenance, see [releasing](docs/releasing.md).
