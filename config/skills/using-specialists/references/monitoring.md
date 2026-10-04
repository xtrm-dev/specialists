# Monitoring Specialist jobs

Monitor by state transition and evidence, not by tight polling.

The native wake is primary. On Claude Code a channel push names the activation and the
tool to read it with; on Pi the extension delivers a follow-up message that starts a turn.
The push is a reference, never the payload:

- `specialist_status` is the authoritative read of live state and pending asks;
- `specialist_result` returns the full output of a settled activation, from memory or
  `observability.db`, by full id or short prefix;
- a missed wake degrades to reading `specialist_status` late, never to a different answer.
  On Claude Code the wake-watch hook is the fallback wake.

Stable semantics:

- `running` means work is active, not successful;
- `waiting` is a continuation state: answer with `specialist_reply`, continue with
  `specialist_resume`;
- terminal/completed state says execution stopped, not that the answer is correct;
- a persisted final result is the worker's claim and must be consumed before advancing;
- `failed` needs an explicit decision. A provider failure (quota, rate limit) is retried
  in place with `specialist_retry`, optionally with `model_override`; a fallback chain
  pushes one `failed` wake for its final outcome, not one per model leg;
- stop each activation you own with `specialist_stop_activation` when it is done.

General peer messaging and reply obligations belong to `/multiplexing`.

When context pressure threatens the coordinator, persist activation ids, states, pending
asks/findings, and the next action, then hand off through `/using-xtrm` (Continuity).

Operator-only equivalents (humans, scripts, legacy `sp run` jobs): `sp ps`, `sp feed`,
`sp result`. An agent with the native tools does not use them.
