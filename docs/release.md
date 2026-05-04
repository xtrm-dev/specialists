# Release inputs

`changelog-keeper` now reads two synthesis inputs:

1. closed beads + git range signals
2. xt session reports from `.xtrm/reports/` for same release window

The report layer is the higher-signal source. It captures intent, attempted approaches, discarded ideas, and post-mortem context. Use it to write WHY-grounded release bullets instead of file-diff summaries.

## Report bundle cap

Report injection is capped at about 50k bytes/tokens. If range is larger, oldest reports are dropped and a cap note is prepended. Release still runs.

## Operator range

Default range is previous tag..HEAD. Backfill runs may pass explicit `--from` / `--to` refs, and report selection follows that same range.

## Result

Keep-a-Changelog markdown still comes out unchanged. Only input quality changes.