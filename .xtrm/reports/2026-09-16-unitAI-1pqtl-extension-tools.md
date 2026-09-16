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

---

# True closeout — unitAI-1pqtl extension resolution

**Date** 2026-09-16 · **Authority** `origin/master` = `4dbc226186bbdebbf6813348c89d21053775cee9` ·
**Status** FUNCTIONALLY CLOSED with accepted/owned residuals · **Release blocker** NO

This section is the durable closeout receipt. It re-derives the state from current master rather
than restating the landing report above. No extension behaviour was changed while producing it.

## 1. Authority

`git fetch origin --prune` returned no new objects: **`origin/master` has not advanced** since the
last external verification.

| Ref | SHA |
|---|---|
| `origin/master` | `4dbc226186bbdebbf6813348c89d21053775cee9` |
| local `master` | `4dbc226186bbdebbf6813348c89d21053775cee9` |
| merge-base(`HEAD`, `origin/master`) | `4dbc226186bbdebbf6813348c89d21053775cee9` |
| working tree (main checkout and session worktree) | clean — `git status --porcelain` returned 0 entries in both |

Every commit of the release window is an ancestor of current master:

```text
20b888b4  merge: native dispatch exposes enabled extension tools (unitAI-1pqtl.2)
6ae4c7ea  fix(unitAI-1pqtl.3): resolve declared git: sources to pi checkout cache
57a2c758  fix(unitAI-rx1bu): resolve npm: extension sources under native dispatch
e4ba991b  feat(unitAI-1pqtl.2): discover-then-pin enabled extension tools into the effective contract
f0f4897a  2fe65f50  refuse shadowed granted names / catalog reserved set + required param
d2302510  executor(SPECIALISTS-83): bound and observe the double session_start
36d5a861  fix(SPECIALISTS-88): name the admission mechanism of the path that prints the contract
4009a09c  docs(native): state which extension sources the native path resolves
4204b7ea  test(SPECIALISTS-88): pin the native admission mechanism as a negative pair
4617a710  7216f026  release artifacts + dist rebuild
4da040a4  docs(report): enabled extension sources under native dispatch
4dbc2261  chore(release): record the report in the changelog
```

## 2. Functional behaviours verified by reading the live code path

Not inferred from tests. Each row names the current-master construct that implements it.

| Behaviour | Evidence on current master |
|---|---|
| Discovery precedes effective-contract finalisation | `native-host.ts` resolves → `discoverDynamicExtensionTools` → `withDiscoveredExtensionTools` → prompt → admission → session |
| Discovered tools are pinned into the effective allowlist | `withDiscoveredExtensionTools` appends to `toolsList`/`extensionTools`/`toolsFlag`; `native-host.ts:1643` pins `[...effectiveToolContract.toolsList, ASK_TOOL, ESCALATE_TOOL]` |
| No model prompt in baseline/discovery sessions | both sessions carry a `systemPrompt` label and are only enumerated then disposed; no `prompt(` call exists on either path |
| The real session receives the final effective allowlist | `baseSessionOptions.tools` is built once from `effectiveToolContract` and reused by primary, fallback and retry sessions |
| Promised-vs-active verification still applies | `createVerifiedSession` → `missingPromisedTools` refuses `tool_contract_unsatisfied` before any model turn |
| Shadow refusal: granted natives, catalog extension tools and ask/escalate | `reservedNames: [...toolContract.nativeTools, ...toolContract.extensionTools, ASK_TOOL, ESCALATE_TOOL]`; a non-builtin registry source throws `enabled extension shadows granted tool '<name>'` → `reject('extension_tool_shadowed')` |
| Collision refusal against a dynamically enumerated builtin set | `builtinSet` from `enumerateBuiltinToolNames`; colliding names go to `refusedCollisions` |
| Ask/escalate names unpinnable in a third layer | `HOST_TOOLS = {ask_coordinator, escalate_to_coordinator}` filter inside `withDiscoveredExtensionTools`, plus the per-name skip in the host loop |
| Fail-closed where intended | empty discovery throws; the mixed baseline-empty/attribution-available case throws; denied native names cannot be pinned even if a caller misses them |
| `local` / `npm:<pkg>` / `git:<spec>` resolution | `resolveDeclaredExtensionSources` → `resolveNpmExtensionSource` → `resolveGitExtensionSource` (`<agentDir>/git/<spec>`, manifest-required, `..`/absolute rejected) |
| `http:` / `https:` / `ssh:` / `github:` | in `NON_LOCAL_EXTENSION_PREFIXES`, matched by neither resolver, therefore reported-and-skipped with a remedy line |
| Two-session invariant (SPECIALISTS-83) | `enumerateBuiltinToolNames` creates its own `noExtensions: true` session with `additionalExtensionPaths: []`; discovery creates a second session carrying the declared sources |
| The baseline does NOT load dynamic sources | the discovery call passes `additionalExtensionPaths: [...input.dynamicExtensions]`; the baseline passes `[]` |
| The code records WHY the sessions must not be merged | VETO block on `enumerateBuiltinToolNames` (shadowed builtin appears once with the extension's source, fails `BUILTIN_TOOL_SOURCES`, becomes pinnable) plus the call-site pointer |
| The double-session telemetry still exists | `emit('extension_discovery_sessions', {fenced_sessions: 2, …})` on success and refusal paths; pinned by the suite at `activation-native-host.test.ts:3801-3850` |

## 3. Probes executed

All three run from the repository root with the documented `TMPDIR=/var/tmp`. Every one creates real
pi SDK sessions; none spends a model turn.

| Probe | Exit | Result |
|---|---|---|
| `scripts/probe-extension-tool-surface.ts` | 0 | `host verdict: all host-level checks pass (Q/R/S/T) and no falsifier fires`; 19 sessions, mean creation 285 ms. Q pinned `[ast_grep, intercom]` → active `[ast_grep, intercom, read]`; R took `ast_grep` from absent to active through the host pin; T refused `write` and rendered `refused extension tool 'write': collides with a builtin tool name`; S did not widen. The single `FAIL I` line is the deliberately non-fatal premise document (F4) |
| `scripts/probe-git-extension-tool-surface.ts` | 0 | `git:github.com/alonw0/pi-claude-link` → `<agentDir>/git/github.com/alonw0/pi-claude-link`; `discoveredRaw` and `pinned` = `[claude-link]`; real pinned session active = `[claude-link, read]`; `PASS: git checkout resolves and claude-link is active`. The same run printed the reported-and-skipped remedy lines for `git:` with no checkout, `https:`, `http:` and `ssh:` |
| `scripts/probe-live-extension-admission.ts` (added by this closeout) | 0 | all six checks pass — see below |

The three existing durable probes assert discovery, but none asserted that a discovered tool can
actually RUN. The added probe closes that gap as the end-to-end acceptance, and is the reason it is a
repository script rather than an ad-hoc run: the claim is reproducible.

```text
1 every declaration resolves to a local directory      local=2 skipped=0
2 each declared source contributes at least one pinned tool
   pinned=["ast_grep","claude-link"] refusedCollisions=[] refusedProvenance=[]
3 the rendered contract names discover-then-pin, never the tool-policy gate
   rendered: - exposed extension sources (registered tools admitted by discover-then-pin
             into this session's tool allowlist): npm:pi-ast-grep, git:github.com/alonw0/pi-claude-link
4 the real session exposes every promised tool, discovered ones included
   active=["ast_grep","claude-link","gitnexus_context","gitnexus_detect_changes",
           "gitnexus_impact","gitnexus_list_repos","gitnexus_query","read"]  missing=[]
5a the discovered tool has an invocable definition
5b the discovered tool executes and returns real matches     found 9 matches
```

Step 5 invokes `ast_grep` directly through the session-exposed definition, so the invoked
implementation is the one the extension registered. It is not an LLM tool call.

## 4. Gates

| Gate | Command | Result |
|---|---|---|
| Targeted suites | `vitest run` over 6 files | **6 files passed · 164 passed \| 4 skipped (168) · exit 0** |
| Typecheck | `bun run lint` (`tsc --noEmit`) | exit 0, no diagnostics |
| Build 1 | `NODE_ENV=test bun run build` in the main checkout | exit 0 |
| Dist coherence | `git diff --exit-code -- dist/` after build 1 | exit 0 |
| Build 2 (reproducibility) | `NODE_ENV=test bun run build` again, same checkout | exit 0, then `git diff --exit-code -- dist/` exit 0 |
| Dist content hash | `sha256` over all of `dist/` before and after | unchanged: `75b0d020fbb3ba3888b4dedb9064ecba8de16a2533656b8c33c5b35ef7898d0b` |
| Changelog | `node scripts/changelog-update.mjs --check` | exit 0, `CHANGELOG.md: already up to date` |
| Package payload | `npm pack --dry-run --json` + `scripts/assert-package-payload.sh` (the CI asset list) | `package payload check passed: all required assets present` |

Targeted suite breakdown — the counts are a scoped result, **not** a full-suite result:

```text
unit/specialist/activation-native-host.test.ts       112 passed
unit/specialist/execution-profile-parity.test.ts      18 passed
unit/specialist/activation-parity.test.ts             12 passed
unit/pi/extension-tool-policy.test.ts                 11 passed   (legacy gate, still relevant)
unit/specialist/resolved-tool-contract.test.ts        10 passed
integration/pi/extension-grant.test.ts                 1 passed
```

The full suite was **not** re-run in this closeout. The targeted green above must not be read as
"full suite green".

## 5. Branch and worktree cleanup

Proof preceded every deletion. No open pull request pointed at any of these branches
(`gh pr list --state open` returned only dependabot branches and `fix/unitAI-7edw1-tool-grant-resolver`,
which is unrelated and was not touched).

| Branch | Tip | Classification | Proof |
|---|---|---|---|
| `origin/xt/kuux` | `2fe65f50` | MERGED_BY_ANCESTRY | merge-base = tip; `git rev-list --left-right --count origin/master...origin/xt/kuux` = `12 0` |
| `origin/fix/unitAI-1pqtl.3-git-source-resolution` | `6ae4c7ea` | MERGED_BY_ANCESTRY | merge-base = tip; `8 0` |
| `origin/fix/SPECIALISTS-83-double-session-start` | `47813b25` | PATCH-EQUIVALENT STALE POINTER | tip ≠ any master SHA, but `git cherry origin/master` = `-` and `git patch-id` = `3c29ccf7fe8c813b86867f9c00d40118e1185628` for **both** the branch commit and master `d2302510`; the only file difference between the two tips is master's later SPECIALISTS-88 `'discover-then-pin'` argument, i.e. master is strictly ahead |
| `origin/fix/unitAI-34pyf-extension-tool-grants` | `d444d6d6` | PATCH-EQUIVALENT STALE POINTER | all 11 branch commits return `-` from `git cherry origin/master`; branch is 366 commits behind |

The unitAI-34pyf branch is beyond the three branches named for this closeout. It was included
because it is the extension tool-grant workstream this epic exists to reach parity with, it carries
no unique commit, and it has no open PR.

Deleted: the four remote branches above, plus the local pointers `xt/kuux`,
`fix/unitAI-1pqtl.3-git-source-resolution`, `fix/SPECIALISTS-88-contract-names-real-mechanism`,
`xt/review-34pyf`, `xt/review-34pyf-v2`.

Worktrees removed: `.xtrm/worktrees/specialists-xt-pi-kuux`,
`.xtrm/worktrees/specialists-xt-claude-review-34pyf`,
`.xtrm/worktrees/specialists-xt-claude-review-34pyf-v2`. All three were clean before removal.

No history was lost: after deletion every removed tip is still either an ancestor of master
(`2fe65f50`, `6ae4c7ea`, `36d5a861`) or retained as an object patch-equivalent to a master commit
(`47813b25`, `d444d6d6`, `6129ebb1`, `b286e2c8`).

Retained deliberately:

- `master`, `origin/master` — the authority.
- `xt/8158` and this session's worktree — the branch this closeout was produced on.
- Every other branch in the repository. This closeout swept only the extension-resolution
  workstream; the remaining branches were not examined and are not covered by this receipt.

## 6. Accepted residuals

Classified, not blurred. A residual here is owned and recorded, not hidden.

| Residual | Owner | Status on current master |
|---|---|---|
| `http:` / `https:` / `ssh:` sources have no local form | accepted by decision (unitAI-1pqtl.3 option A) | Confirmed: reported-and-skipped with a message naming the source and the remedy. Unconditional refusal was rejected because `git:…/pi-claude-link` is enabled fleet-wide and refusal would block every activation |
| `github:<owner>/<repo>` does not resolve | `unitAI-lq1mw`, P3, **OPEN** | Confirmed open, and it is the correct owner: `github:` is in `NON_LOCAL_EXTENSION_PREFIXES` while `resolveGitExtensionSource` matches only `git:`, so a `github:` declaration takes the skip path. The issue carries the measurement-first instruction and the attribution-label question |
| Legacy `sp run` does not activate `git:`-sourced tools | recorded; retired by XTRM-93 | Real, documented native/legacy divergence, not a defect to fix here. `docs/native-activation.md` states it, `native-host.ts:143-171` expresses it as a checked parity shape (`native == legacy minus non-local sources`), and the closed unitAI-1pqtl epic names it in its boundary. No separate bead tracks it; see §8 |
| `unitAI-74xy4` — bind discovery attestation to bytes | `unitAI-74xy4`, P2, **OPEN** | See §7 |
| A curated extension shadowing a granted native is undetected | accepted with an expiry trigger | Recorded in code at `native-host.ts:1601-1605` (R3.4a). Holds only while the curated set stays host-resolved and in-repo. Expiry trigger: if curated paths ever become user-supplied, this becomes a finding. The SPECIALISTS-85 audit did **not** trip that trigger |
| Old SDKs without `getAllTools` cannot detect granted-name shadowing | accepted | No widening results (no provenance ⇒ nothing pinnable), but the shadow itself is invisible there |
| Double session_start per dynamic activation | accepted safety cost | Bounded at exactly two fenced sessions, observed by `extension_discovery_sessions`, and deliberately not optimised away. SPECIALISTS-83 is DONE/TERMINAL in Substrate |

## 7. `unitAI-74xy4`, stated precisely

Not a generic "security follow-up".

- **Invariant it protects.** The contract the operator approved must describe the code that
  executed. Native dispatch resolves sources once to strings and then loads the bytes more than
  once: the discovery session, then the real child session. Post-load verification is name-only
  (`missingPromisedTools` compares `getActiveToolNames()` sets).
- **What breaks.** A source that mutates between the two loads — npm reinstall, `git pull`,
  in-place body edit, symlink swap — runs different code under an identical name set while the
  prompt contract, `activation_admitted.tools`, the forensic pinned list and the `tools` allowlist
  all describe the pre-mutation registry.
- **Is the extension implementation safe without it.** Yes, for the property this workstream owns.
  All four refusals fail closed when they fire; empty discovery refuses; post-load
  `tool_contract_unsatisfied` refuses; a mutation that removes a pinned name or adds a
  colliding/shadowing one is caught. The exposure is strictly a same-name-set body swap. The
  operator enabled the source and its load-time code already runs, so this is an
  integrity/auditability gap, **not** privilege escalation.
- **Does it block release.** No. The issue states "Not release-blocking; fixable in a bounded
  change", and nothing found in this closeout contradicts that.
- **Closure condition.** Bind attestation to bytes: take content identity at discovery (hash or
  git commit for `git:` checkouts, resolved-package hash for `npm:`, mtime+hash for local paths),
  re-verify before prompt render and before every session creation (primary, fallback, retry,
  resume), record it in `activation_admitted`/snapshot, and refuse on mismatch. The carried smaller
  findings (A1 per-source attribution, I1 npm `@spec` decorative at load, M3 resume re-verifies
  nothing) must land with it. The issue names no separate time-based expiry trigger.
- **Verdict.** Correctly open, correctly scoped, correctly labelled `contract:ready`. Nothing in
  newer work satisfied it. Left open.

## 8. XTRM-93 interaction

XTRM-93 is a separate board, not this repository's Beads store; `bd show XTRM-93` returns not
found, and no XTRM-93 item was touched. Its live items in this repository are the Substrate issues
SPECIALISTS-77, -78, -80, -81, -86, -87 and -92, all OPEN, all out of scope here.

The one hand-off is deliberate: the legacy `sp run` / `git:` divergence is an accepted residual
that needs no bead of its own **because XTRM-93 retires the legacy execution backend**. If XTRM-93
decides to keep the legacy path, this residual becomes live work again and needs an owner. The
closeout records it here so that decision is made with the residual visible.

## 9. Wording audit

Source, docs and skills were searched for claims that contradict the landed architecture. None
survived:

| Rejected stale claim | Result |
|---|---|
| "native extension tools are admitted by the legacy tool-policy gate" | Not present. `resolved-tool-contract.ts` names both mechanisms and defaults to the legacy one only for callers that run the legacy path; the native call site passes `'discover-then-pin'`. `params: 'tool-policy-gate'` remains the documented default, not a native claim |
| "all registered extension tools are automatically available" | No occurrence in `src/`, `docs/`, `config/` or `.agents/` |
| "`git:` is unsupported on native" | No occurrence. `docs/native-activation.md` states the resolved cache path and documents the legacy divergence instead |
| "dynamic extension discovery uses one reusable session" | No occurrence. The veto comments and the docs state two separate fenced sessions |

`docs/native-activation.md` describes the real mechanism in order: resolve → load the declared
sources in a fenced session → attribute provenance → refuse builtin collisions → pin into the
effective contract → pin the real session to the finalized allowlist → verify the active set.
Documentation vNext was not started.

## 10. Defects this closeout found in its own work

Recorded with the same prominence as the passes, because the first run of the added probe reported
three failures that were mine, not the product's:

1. Ran the live probe with no `extensionSources` argument, so the rendered contract legitimately
   omitted the exposed-extension-sources line, and reported that as a product failure.
2. Ran the live probe's session with only the dynamic sources loaded, so the promised gitnexus
   tools were missing and the promised-vs-active check failed for a reason the host does not have.
3. Invoked `ast_grep` with `export function $A`, which ast-grep parses with an ERROR node and
   matches nothing against, then reported "0 matches" as a callability failure.

All three were harness gaps; each was corrected and the corrected probe passes. The first run's
output is superseded, not deleted: a reader comparing the two runs sees exactly what changed.

## 11. Open follow-ups owned elsewhere

| Item | Owner | Blocks this closeout |
|---|---|---|
| bind discovery attestation to bytes | `unitAI-74xy4` (OPEN, P2) | no |
| resolve `github:` sources to the checkout cache | `unitAI-lq1mw` (OPEN, P3) | no |
| retire the legacy execution backend | XTRM-93 (external board) | no |
| per-source rather than class-level attribution; npm `@spec` enforcement; `resume()` re-verification | carried inside `unitAI-74xy4` | no |

## 12. Verdict

**FUNCTIONALLY CLOSED with accepted, owned residuals.** Every claimed extension behaviour is
present on current master and verified by reading the live code path; every required shipped
artifact is consistent with source; no unique work was stranded on a branch or worktree; each
accepted gap is named above with an owner or an expiry trigger. This is not "complete with no
gaps", and three of the listed residuals remain open by judgement rather than by omission.
