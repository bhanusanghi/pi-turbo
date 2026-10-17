# Publishing and maintenance

The package is local/private. Bun 1.4.3 supplies installation, script execution and `bun pm pack`; `bun.lock` is authoritative. This migration does not publish npm, create a remote repository or tag a release.

## Package contract

`pi-turbo` is now an application library exporting `createTurbo`, a native Durable extension factory. The host installs the returned extension into `createRegistry()` and supplies models/storage. Coding-agent `pi install`, `pi -e`, `pi.extensions` discovery and slash commands are no longer the integration path.

Durable, pi-ai and Chord are **peer dependencies pinned to 1.2.0**, with matching development dependencies. This pin records the tested experimental interface. Do not copy the coding-agent package guide's broad peer ranges into this package without a compatibility policy.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run test
bun pm pack --dry-run
```

`prepack` cleans/builds the runtime package. The archive includes compiled exports/declarations, source and selected core documentation. It excludes application examples, media, local configs, credentials and databases. The package test extracts the archive and executes its exported extension through a real Harness.

## Future authorized release

Choose the package/repository identity, set release metadata, review the tarball, and complete the intended live validation before removing `private: true`. A future release should document the breaking host change and absence of automatic session/ledger import. Pin a prerelease while Durable compatibility is still being evaluated.

Install the resulting npm package in the Durable application alongside the declared host peers. Import `createTurbo` from that package; do not load it as a coding-agent extension.

When upgrading upstream, update peer/development pins and the lockfile together. Inspect changes to native models, hooks/wrappers, task replay, ownership, documents, output schemas and compaction. Re-run recovery and packed-package tests. Preserve compatible definitions for pending tasks, or explicitly migrate/stop them before switching code.

Publication commands and repository changes require their own authorized task. This guide records the release procedure, not publication approval.
