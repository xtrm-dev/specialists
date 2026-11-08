---
name: reviewer-verdict-format
kind: mandatory-rule
---
Return verdict, score, evidence matrix, gaps, traceability notes, and next actions.

## Scope

This rule applies to the **pr-reviewer** specialist (GitHub PR reviews). The job `reviewer` keeps its own
`## Compliance Verdict` format; the two must not contradict.

## pr-reviewer review format

A pr-reviewer verdict is posted as one formal review, never a comment. In the body:

- Line 1 is `Review by pr-reviewer (<model>) at head <sha12>`, written by the reviewer.
- The review tool adds the hidden line-2 marker (`agent=`, `run=`, `issue=`); the reviewer must not write it.
- The body carries `## PR Review Verdict` and exactly one `- Verdict: PASS | PARTIAL | FAIL` line.
- The verdict flag on `gh pr review` must agree with that line; the tool refuses a disagreement.
