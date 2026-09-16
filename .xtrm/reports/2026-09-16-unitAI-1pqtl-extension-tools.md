# Enabled extension sources now expose their tools under native dispatch — unitAI-1pqtl

**Date** 2026-09-16 · **Tree** master @ 7216f026, pushed to `origin/master` · **Runner**
coordinator session `specialists-xt-pi-kuux` (`01a0a780`), with an independent peer session
(`subagent-chat-01a0a7b8`) verifying from the stores and from fresh processes.

## What this run is

The owner requirement was one sentence: **enabling an extension in the config must be enough to
get its tools.** It was not true. `npm:pi-ast-grep` was enabled for every specialist, the
extension loaded, and `ast_grep` still never reached the child, because native activation fences
the child with pi's `tools` option — a hard, creation-time allowlist built only from catalog tool
names. Anything an operator-enabled extension registered was registered and then silently dropped.

The legacy `sp` path had been fixed for this (`unitAI-34pyf`) by appending a fail-closed
tool-policy extension. Native dispatch has no equivalent, and that gate **provably cannot** work
there: injected in either load order it left the list clipped to `[read]`, and
`setActiveToolsByName` cannot widen a session after creation.

## The decision, and the route that was rejected

**Chosen: discover-then-pin.** A fenced, never-prompted discovery session loads only the resolved,
deduplicated, operator-enabled dynamic sources, enumerates the registry with per-name provenance,
and pins names into the effective contract **before** the prompt is rendered, admission runs and
any session is created.

**Rejected: declaration** (a catalog entry keyed by source, or an explicit config/definition field
naming each extension's tools). Three reasons: the owner requirement is that config enablement
suffices, so a per-extension declaration in our source recreates exactly the burden being removed;
`pi-ast-grep` ships no tool names statically anyway, so declaration means authoring them per
extension; and `ToolCatalogName` is a closed union (`src/specialist/manifest-resolver.ts:2`), so a
new catalog is a type change plus a per-catalog runtime resolver — a second load path.

Two falsifiers were probed **before** any host code was written, and one fired: an extension
registering a name that matches a builtin (`write`) is discoverable, pinnable, and shadows the
builtin in a single registry entry. That produced the collision refusal, the extension-class
provenance check, and later the shadow refusal described below.

## Measured, in order

| # | Surface | Result |
|---|---|---|
| 1 | Probe A — current behaviour | extension path loaded, `tools` without `ast_grep` → active `["read"]` |
| 2 | Probe B — same, name supplied | active `["ast_grep","read"]` (registration was never the problem) |
| 3 | Probe G — fenced registry enumeration | `["ast_grep"]`, builtins fenced |
| 4 | Probe I — collision fixture | raw pin of `write` **activates** it: the falsifier that fired |
| 5 | Probe M/N — dynamic builtin set | 8 names enumerated; collision refused by subtraction |
| 6 | Probe Q — real executor config | pinned `["ast_grep","intercom"]`, active incl. `read` |
| 7 | Probe R — the original reproducer | `ast_grep` absent without the pin, active with it |
| 8 | Probe T — collision through the host pin | `["read","probe_benign"]`, `write` refused, warning names it |
| 9 | git: source (`.3`) | `git:…/pi-claude-link` → checkout resolved, `claude-link` pinned + active |
| 10 | Affected suites | 157 tests across five files, `tsc` clean |
| 11 | Full suite (final content) | 237 files passed / 11 skipped; **2968 passed / 34 skipped**, exit 0 |
| 12 | Fresh-process admission | `SPECIALISTS-76` verbatim `--tools:` includes `ast_grep`, `intercom` |
| 13 | Fresh-process callability | `SPECIALISTS-82`: ast_grep **executed**, 5 matches |
| 14 | Acceptance test | `SPECIALISTS-61` passed with 50+ ast_grep calls; **zero receipts before the fix** |

## Why the security work mattered more than the feature

A quality review approved the change (`accept with follow-ups`, 7/10). A security review then found
a hole the first lens could not see, because it audited against the contract's question and not
against what names *resolve to*: **refusing to pin a colliding name does not unload the extension.**
The real session still loads it, so an extension registering a name the child is granted anyway
(`read`/`grep` for READ_ONLY, `edit`/`write`/`bash` for MEDIUM/HIGH) executes extension code behind
a passing name-level check — contract and promised-vs-active both green. Fixed by refusing the
activation when any reserved name (granted natives ∪ ask ∪ escalate) arrives with a non-builtin
source, verified closed, and a further reachable subset (catalog-granted names) closed in a third
round. `ask_coordinator`/`escalate_to_coordinator` are now unpinnable in three independent layers.

The same review produced the standing veto that shapes all later work: the **baseline registry must
be enumerated without the dynamic sources present**, because with them loaded a shadowed builtin
vanishes from the baseline set and a non-granted builtin becomes pinnable. That veto is now a code
comment *and* a mutation-checked test, not advice.

## What this run does NOT prove

- **`http:`/`https:`/`ssh:` sources are still reported-and-skipped**, with a message naming the
  source and the remedy. They have no local form and pi's loader takes paths only. Accepted
  deliberately (unconditional refusal would block every activation, since `git:…/pi-claude-link`
  is enabled fleet-wide).
- **The legacy path does not activate `git:`-sourced tools.** Native now does. A real, documented,
  checked divergence — not hidden, not merged away.
- **A curated extension shadowing a granted native is undetected** while the curated set stays
  host-resolved and in-repo. Acceptance with a recorded expiry trigger: if curated paths ever
  become user-supplied, this becomes a finding.
- **Old SDKs without `getAllTools` cannot detect granted-name shadowing.** No widening results (no
  provenance means nothing pinnable), but the shadow itself is invisible there.
- **`unitAI-74xy4` is open by judgement**: the discovery load and the real load are separate loads
  over live bytes, so same-name code substitution is silently accepted. Integrity/auditability, not
  privilege escalation — the operator enabled the source and its load-time code already runs. This
  is stated as a judgement with reasoning, not hidden behind a green suite.
- **The end-to-end artifact check is the peer's, and it is the only one suites cannot substitute
  for**: a fresh process (not a session that loaded a pre-change bundle) dispatching a child whose
  contract forces it to quote its own `- exposed extension sources` line.

## Defects this run found in my own work

1. **Closed `unitAI-1pqtl.3` prematurely** with a reason claiming "landed, suites green, dist
   rebuilt" while the commit existed only on a branch and master still lacked it. Corrected by
   note; the reason was true only after the fact.
2. **Staged a conflict-marker file into a merge commit**: I truncated the merge output with
   `tail -4` and ran `git add -A` *before* checking for unmerged paths, so my own check reported
   clean. `tsc` caught it. The lesson is the check order, not git.
3. **Merged into the wrong ref**: the main checkout was on the peer's branch, so my first merge
   merged `88` into itself and my fast-forward targeted the wrong branch. Caught by checking
   ancestry instead of trusting the output.
4. **Reported a false finding against a peer's store** ("zero journal entries") from my own parser
   bug — `sb journal show --json` returns an array, `sb issue show --json` an object, and I assumed
   a key. Retracted with the same prominence as the claim.
5. **Two contract-shaped gate refusals** on my own dispatches: a missing `SUCCESS`, then a
   decorated `NON_GOALS — …` heading. The gate requires bare section headings, which is exactly
   what `unitAI-rrdnt.57` describes.
6. **An overstated reproducibility caveat** whose confirming check was confounded by my own
   cleanup. Settled by blob evidence and a fresh measurement rather than by argument.

## Reproducibility, stated precisely

`dist/lib.js` — the artifact the pi extension imports — is byte-identical across the main checkout
and a linked worktree at the same commit (`a6b90e6e0fb0`) and deterministic in-checkout.
`dist/index.js` — the CLI bundle — must be produced **in the main checkout**: blob history shows
`89` committing `b53011a80393` (a worktree build) and the release commit replacing it with
`fc02ac28bef1` (the main build), and a fresh worktree build reproduces the difference.

## Operator consequence

The committed CLI bundle must always be rebuilt in the main checkout after a worktree-side change,
because a worktree build of the same source is not that artifact.
