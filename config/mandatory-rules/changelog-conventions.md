---
name: changelog-conventions
kind: mandatory-rule
rules:
  - id: keep-a-changelog
    level: required
    text: "Use Keep-a-Changelog format with YAML frontmatter, version headers, and top-level sections Added, Changed, Fixed, Removed, Deprecated, Security."
  - id: one-line-entries
    level: required
    text: "Keep each changelog entry to one line."
  - id: bead-references
    level: required
    text: "Include bead-id references in parentheses when helpful, like (unitAI-123)."
  - id: conventional-commit-mapping
    level: required
    text: "Map conventional commits to sections: feat -> Added, fix -> Fixed, refactor/perf -> Changed, docs -> Changed, chore -> Changed unless user-facing, revert -> Removed, sec/security -> Security."
  - id: section-completeness
    level: required
    text: "Draft all applicable sections in this order: Added, Changed, Fixed, Removed, Deprecated, Security. Omit only empty sections."
---
Changelog drafting rules for release automation.
