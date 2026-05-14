---
name: diagnose-loop
kind: mandatory-rule
---
Trace symptom to root cause before editing. Use stack trace and call graph to pinpoint suspects; reproduce the failure; apply the minimal fix on the fault line. Do not refactor surrounding code, change style, or expand scope. Verify with targeted lint/typecheck and a focused repro — full suites belong to test-runner. Cite evidence as `file:line` for each claim.
