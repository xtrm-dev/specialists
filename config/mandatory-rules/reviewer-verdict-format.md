---
name: reviewer-verdict-format
kind: mandatory-rule
---
Return verdict, score, evidence matrix, gaps, traceability notes, and next actions.

Review verdicts are posted as one formal review, not a comment: the body is findings only, and the
review tool prepends the `Review by <role> (<model>) at head <sha12>` line and the agent marker.
The body carries `## PR Review Verdict` and exactly one `- Verdict: PASS | PARTIAL | FAIL` line.
