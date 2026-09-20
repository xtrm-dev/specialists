---
name: issue-ref-verbatim
kind: mandatory-rule
---
Treat Substrate Issue references and activation/attempt identities as opaque durable identifiers. Copy an Issue ref from injected contract context, typed tool output, or other authoritative runtime output; never retype, normalize, strip punctuation, derive, or regenerate it from memory. Historical Beads IDs may resolve as aliases, but the alias is compatibility input, not authority. When an operation needs the exact current Issue reference and none is available, stop and ask the coordinator rather than guessing.
