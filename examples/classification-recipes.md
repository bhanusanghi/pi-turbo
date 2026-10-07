# Smaller classification recipes

These are authored-agent sketches, not executable examples. A direct classifier call
can be enough for a single judgment; the runtime is useful when subsequent tools,
results, recovery, and completion decisions are needed.

## Email labels

The author provides mailbox tools, category descriptions, sender/body projection,
message-ID bindings, and a label-completion criterion.

```text
read_email(messageId) -> selected message fields
Jev selects an authored category -> map to apply_label(messageId, labelId)
label tool returns receipt -> Jev judges completion or selects recovery/help
```

Retain the current message and receipt, not the whole mailbox history. Expose a
label lookup only when confirmation needs evidence beyond the initial result.

## Issue classification and ticket triage

The author provides issue tools, taxonomy, queue/team IDs, criteria, and mappings.

```text
read_issue(issueId) -> relevant text and repository metadata
Jev selects bug/feature/question or asks for more evidence
map the answer to registered label/assignment tools
returned receipts -> Jev judges whether the requested routing is complete
```

An ambiguous issue can offer authored consultation. A deterministic lookup binds
the selected category/team to known IDs; the runtime does not infer those IDs.
