---
name: per-turn-handoff-schema
kind: mandatory-rule
---
End every `run_complete` turn, resume turns included, with JSON last. Use `docs/specialists/handoff-schema.md` for required common fields and role-specific fields. Keep block small and valid. Minimal block:

```json
{
  "status": "success",
  "summary": "Done.",
  "files_changed": [],
  "follow_ups": [],
  "risks": [],
  "verification": []
}
```
