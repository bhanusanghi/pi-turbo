# Changelog

## Unreleased

- Add optional typed decision evidence retained in native entries before signed actions, with atomic idempotency, diagnostic records, and host-controlled access.
- Verify recorder failure gates, native retained reads, consultation links, and evidence recovery across SIGKILL and package extraction.

- Keep this package scoped to the reusable runtime, core documentation and native tests.
- Use Bun 1.4.3 for runtime, package management and tests; reuse Durable's stock SQLite adapter in runtime verification.
- Fix active capability reporting and preserve explicit null nested tool evidence.
- Migrate from pi-coding-agent 1.0.4 to native Pi Durable / pi-ai / Chord 1.2.0.
- Replace companion registration and lifecycle controller with `createTurbo`, native extensions, hooks, tool wrappers and a local decision provider.
- Add serializable, versioned decision packets and native task memos for pending-work recovery.
- Build optional System 2 on an owned Durable conversation with scoped tools, persisted limits/deadlines and evidence returned to System 1.
- Verify native SQLite integration, separate-process SIGKILL recovery and packed-package execution.
- Breaking: coding-agent loading/slash commands and old sessions are not automatically migrated.
- Automatic context management and learning remain outside V1. Package remains private; live model quality remains unverified.
