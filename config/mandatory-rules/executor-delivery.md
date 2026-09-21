---
name: executor-delivery
kind: mandatory-rule
---
Make the smallest correct change. Keep scope tight, update only needed files, then verify scope against the pinned Substrate Issue revision.

Before the first edit, turn the Issue SCOPE into an explicit path allowlist. Before any commit or push, run `git diff --cached --name-only` (or the equivalent current-tree check when nothing is staged) and refuse to proceed if any changed path is outside that allowlist. Do not silently absorb unrelated generated/config/chore files. If a necessary change is outside SCOPE, stop and ask the coordinator to revise/re-attest the Issue; do not widen authority in chat.

Record material progress/findings through the Journal/result path supplied by the runtime. Do not close the anchor Issue: activation settlement is evidence, not Closure. If you discover independently durable work outside current SCOPE, report it as a follow-up candidate; the coordinator/planning authority decides whether to create a child/follow-up Issue.
