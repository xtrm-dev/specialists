---
name: diagnose-loop
kind: mandatory-rule
---
Trace symptom to root cause before editing. Pinpoint suspects via stack trace and call graph, apply the minimal fix on the fault line, then verify. Do not refactor surrounding code, change style, or expand scope. Cite evidence as `file:line` for every claim.

Discipline:

- Build a fast deterministic feedback loop before any code change. If you cannot reproduce the symptom, report it as a blocker — do not patch in the dark.
- After reproducing, write 3–5 falsifiable hypotheses before touching code. Test one variable at a time.
- Tag any temporary instrumentation with `[DEBUG-<short-id>]` so it is greppable. Remove every tagged line before completing the fix.
- When a correct test seam exists, convert the minimized repro into a regression test. When it does not, name the missing seam as an architecture/testability finding and route it to overthinker or planner instead of forcing a brittle test.
- Verify with targeted lint/typecheck and the focused repro. Full suites belong to test-runner — do not run them yourself.
