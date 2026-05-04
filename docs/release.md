# Release inputs

`xt release` now reads two synthesis inputs:

1. closed beads + git range signals
2. xt session reports from `.xtrm/reports/` for same release window

`sp release prepare` / `sp release publish` remain as deprecated aliases for backward compatibility. They proxy to the same release logic and print a deprecation notice on every invocation.

The report layer is the higher-signal source. It captures intent, attempted approaches, discarded ideas, and post-mortem context. Use it to write WHY-grounded release bullets instead of file-diff summaries.

## Report bundle cap

Report injection is capped at about 50k bytes/tokens. If range is larger, oldest reports are dropped and a cap note is prepended. Release still runs.

## Operator range

Default range is previous tag..HEAD. Backfill runs may pass explicit `--from` / `--to` refs, and report selection follows that same range.

## Result

Keep-a-Changelog markdown still comes out unchanged. Only input quality changes.
