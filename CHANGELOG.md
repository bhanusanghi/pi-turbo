# Changelog

## Unreleased

- Use Bun 1.4.3 for runtime, package management and tests; reuse Durable's stock SQLite adapter and Fastify/TypeBox HTTP, with Bun.SQL PostgreSQL connections, Bun lockfiles and CI.
- Fix active capability reporting, remove repeated consultation inputs/accounting from news judgments, and preserve explicit null nested tool evidence; version the news recipe as durable-2.

- Migrated from pi-coding-agent 1.0.4 to native Pi Durable / pi-ai / Chord 1.2.0.
- Replaced companion registration and lifecycle controller with `createTurbo`, ordinary native extensions, hooks, tool wrappers and a local decision provider.
- Added serializable, versioned decision packets and native task memos for pending-work recovery.
- Rebuilt optional System 2 around an owned Durable conversation, scoped native tools, persisted limits/deadlines and structured evidence returned to System 1.
- Moved the news application to ordinary Durable documents/tools and an application-defined native watch task with worker commands.
- Retained author-managed context, A+B evidence, preview, exact receipt deduplication and uncertain-send reconciliation.
- Added native SQLite integration, separate-process SIGKILL recovery, adapter and packed-package tests; updated HLD/LLD and migration documentation.
- Breaking: coding-agent loading/slash commands and old session/JSON ledger formats are not automatically migrated.
- Automatic context management and learning remain outside V1. Package remains private; live model quality and external delivery remain unverified.
