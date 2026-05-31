# seconder dual-verdict eval

Static eval proving seconder gate behavior before expensive QA.

## Fixtures

- `wrong-scope/` — contract asks for `src/foo.ts` type change, diff also edits unrelated `src/bar.ts`. Expected: `scope_verdict=FAIL`, `quality_verdict=PASS`, `overall_verdict=FAIL`.
- `bad-quality/` — on-scope diff, but unsafe type-cast smell. Expected: `scope_verdict=PASS`, `quality_verdict=FAIL`, `overall_verdict=FAIL`.
- `clean/` — on-scope clean diff. Expected: `PASS/PASS/PASS`.

Each fixture contains:
- `contract.md`
- `diff.patch`
- `expected-verdict.json`

## Why this eval matters

This eval proves `seconder` can block writer output before test-engineer / expensive QA. The routing consequence is orchestration behavior from `config/skills/using-specialists-v3` seconder gate docs, not runtime-enforced in this repo.

## Operator run

`run.sh` is operator-only and must not run inside executor sessions.

Suggested flow:
1. For each fixture, inline `contract.md` + `diff.patch` into `sp run seconder --prompt ...`.
2. Parse fenced JSON output.
3. Compare against `expected-verdict.json`.
4. Fail if any dimension mismatches.

## Token-cost note

Estimate only, no live measurement:
- seconder dispatch: cheap fused gate, one model call, low prompt size.
- avoided cost on wrong-scope path: at least one wasted test-engineer dispatch plus downstream reviewer churn.
- break-even: if wrong-scope or bad-quality failure avoids even one expensive QA hop, fused seconder is net win.

Rough read: seconder cost is O(1) small prompt over a single diff; avoided chain cost is one extra specialist turn plus whatever test-engineer would have spent. That is break-even-positive for any non-trivial failed writer diff.
