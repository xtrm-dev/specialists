---
name: gitnexus-required
kind: mandatory-rule
---
Use GitNexus before editing any function/class/method.

Tools (prefer MCP; fall back to CLI if MCP unavailable):
- Blast radius before edit: `gitnexus_impact({target, direction:"upstream"})` or `npx gitnexus impact <target>`. STOP and warn if HIGH/CRITICAL.
- Symbol callers/callees: `gitnexus_context({name})` or `npx gitnexus context <name>`.
- Concept search: `gitnexus_query({query})` or `npx gitnexus query "<text>"`.
- Execution flow trace: `gitnexus_query({query: "<flow-keyword>"})` (process-grouped results) or read the MCP resource `gitnexus://repo/<name>/process/<flow-name>` for the step-by-step trace.
- Pre-commit scope check: `gitnexus_detect_changes()` (MCP only — fallback: `git diff --stat`).

Rules:
- Run impact for every existing symbol you modify; never edit without it.
- Never rename via find-replace — use `gitnexus_rename({symbol_name, new_name, dry_run:true})` first.
- If index is stale, ask the user to run `npx gitnexus analyze`.

New-file scope (escape hatch):
- When the diff adds only new files (new specialist JSON, new mandatory-rule, new test, new doc) and modifies no existing functions/classes/methods, blast-radius analysis is moot. State this explicitly in your output ("new-file scope; no existing-symbol modifications") and skip the impact call.
- This applies to dispatch entries that merely add a routing case to an existing function (e.g. `src/index.ts` subcommand wiring): the touched symbol is the dispatcher, but the change is purely additive and equivalent to a registration. Note the dispatch addition and skip impact — list the new files instead.
- Reviewer compliance: when authoritative_diff shows only new files (or additive dispatch entries), the "verify blast radius" requirement is satisfied by the executor's new-file-scope statement; do not flag as unmet.
