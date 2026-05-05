# Specialist handoff schema

Use at end of every `run_complete` turn, resume turns included.

Common fields for all roles:
- `status`: `success | partial | error`
- `summary`: 1-3 sentences
- `files_changed`: `string[]`
- `follow_ups`: `string[]`
- `risks`: `string[]`
- `verification`: `string[]`

Role-specific fields:
- `reviewer`: `verdict`, `score`, `requirement_coverage[]`
- `executor` / `debugger`: `symbols_modified[]`, `lint_pass`, `tests_pass`, `impact_report`
- `changelog-keeper`: `version`, `commit`, `tag`, `pushed`
- `explorer`: `findings[]`, `recommended_next`
- `code-sanity`: `outcome`, `findings[]`
- `security-auditor`: `outcome`, `findings[]`
- `test-runner`: `pass_count`, `fail_count`, `classification[]`

Notes:
- Keep `reviewer` verdict shape aligned with `reviewer-verdict-format`; do not duplicate its prose rules.
- `tests_pass` may be `true | false | "n/a"` for executor/debugger when tests were not run.
- JSON block must be last in assistant turn.

## Minimal compliant block

```json
{
  "status": "success",
  "summary": "Done.",
  "files_changed": ["config/example.json"],
  "follow_ups": [],
  "risks": [],
  "verification": ["bunx tsc --noEmit"]
}
```

## Role examples

### executor / debugger
```json
{
  "status": "success",
  "summary": "Applied targeted fix and verified compile.",
  "files_changed": ["src/a.ts"],
  "follow_ups": [],
  "risks": [],
  "verification": ["bunx tsc --noEmit"],
  "symbols_modified": ["runTask"],
  "lint_pass": true,
  "tests_pass": "n/a",
  "impact_report": {
    "files_touched": ["src/a.ts"],
    "symbols_analyzed": ["runTask"],
    "highest_risk": "LOW",
    "tool_invocations": 3
  }
}
```

### reviewer
```json
{
  "status": "success",
  "summary": "Reviewed diff against bead.",
  "files_changed": ["src/a.ts"],
  "follow_ups": [],
  "risks": [],
  "verification": ["git diff --stat"],
  "verdict": "PASS",
  "score": 92,
  "requirement_coverage": [
    {"requirement": "schema block", "status": "met", "evidence": "present", "gap": ""}
  ]
}
```

### changelog-keeper
```json
{
  "status": "success",
  "summary": "Release landed.",
  "files_changed": ["CHANGELOG.md"],
  "follow_ups": [],
  "risks": [],
  "verification": ["git diff --stat"],
  "version": "1.2.3",
  "commit": "abc1234",
  "tag": "v1.2.3",
  "pushed": true
}
```

### explorer
```json
{
  "status": "partial",
  "summary": "Mapped likely path and one gap remains.",
  "files_changed": [],
  "follow_ups": ["inspect src/a.ts"],
  "risks": ["Path may be stale"],
  "verification": ["gitnexus_query('concept')"],
  "findings": ["src/a.ts: likely entry point"],
  "recommended_next": "Ask executor to patch src/a.ts"
}
```

### code-sanity
```json
{
  "status": "success",
  "summary": "Checked scope and found no drift.",
  "files_changed": ["src/a.ts"],
  "follow_ups": [],
  "risks": [],
  "verification": ["git diff --stat"],
  "outcome": "OK",
  "findings": []
}
```

### security-auditor
```json
{
  "status": "partial",
  "summary": "Reviewed changes for obvious security issues.",
  "files_changed": ["src/a.ts"],
  "follow_ups": [],
  "risks": ["Input path needs caller validation"],
  "verification": ["git diff --stat"],
  "outcome": "findings",
  "findings": [
    {"severity": "medium", "file": "src/a.ts", "concern": "Unsanitized input", "source": "diff"}
  ]
}
```

### test-runner
```json
{
  "status": "success",
  "summary": "Targeted tests passed.",
  "files_changed": ["src/a.ts"],
  "follow_ups": [],
  "risks": [],
  "verification": ["bunx vitest run src/a.test.ts"],
  "pass_count": 4,
  "fail_count": 0,
  "classification": [
    {"test": "src/a.test.ts", "classification": "in_scope"}
  ]
}
```
