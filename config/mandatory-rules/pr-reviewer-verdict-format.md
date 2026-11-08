---
name: pr-reviewer-verdict-format
kind: mandatory-rule
---
Applies to the **pr-reviewer** specialist only (GitHub PR reviews).

- The verdict is posted as one formal review, never a comment.
- Line 1 of the body is `Review by pr-reviewer (<model>) at head <sha12>`, written by the reviewer.
- The review tool adds the hidden line-2 marker (`agent=`, `run=`, `issue=`); the reviewer must not write it.
- The body carries `## PR Review Verdict` and exactly one `- Verdict: PASS | PARTIAL | FAIL` line at column 0.
- The verdict flag on `gh pr review` must agree with that line; the tool refuses a disagreement.
