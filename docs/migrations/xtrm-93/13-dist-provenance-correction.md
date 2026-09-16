# XTRM-93 — Correction: how `dist/` must be regenerated (supersedes the unitAI-1pqtl operator consequence)

Status: **verified finding, three-way reproduced.** This file corrects a rule that the unitAI-1pqtl
extension-resolution closeout stated, and that the XTRM-93 reconciliation first applied incorrectly.

## 1. The rule that was stated

`.xtrm/reports/2026-09-16-unitAI-1pqtl-extension-tools.md`, "Operator consequence":

> The committed CLI bundle must always be rebuilt in the main checkout after a worktree-side change,
> because a worktree build of the same source is not that artifact.

The reconciliation initially followed that rule: it discarded the lineage's `dist/` and regenerated it
in the main checkout. **That was wrong, and CI rejected it.**

## 2. The rule that actually holds

> `dist/` must be regenerated from a checkout whose dependencies were installed from the lockfile.
> `bun.lock` is authoritative. `bun install --frozen-lockfile` — the command CI uses — defines the
> artifact.

## 3. Evidence

### 3.1 The two hosts resolve a different nested dependency

| host | top-level `node_modules` entries | `@modelcontextprotocol/*/node_modules/zod` |
|---|---|---|
| main checkout `/home/dawid/dev/specialists` | 192 | **4.6.2** |
| any fresh worktree after `bun install` | 151 | **4.5.4** |

`bun.lock` pins the nested resolution explicitly:

```
"@modelcontextprotocol/core/zod":   ["zod@4.5.4", "", {}, "sha512-sC95tT5i…"],
"@modelcontextprotocol/server/zod": ["zod@4.5.4", "", {}, "sha512-sC95tT5i…"],
```

So **4.5.4 is the declared version and the main checkout has drifted to 4.6.2.** The difference is not
`dist/lib.js` — that file is byte-identical in both hosts. It is not the top-level `zod` either:
`node_modules/zod` is 3.25.76 and byte-identical in both (596 files, `diff -rq` clean).

A module-level diff of the two bundles settles which module actually differs. Both bundles contain the
**same 401 module paths**, so nothing was added or removed; the differing region is
`node_modules/@modelcontextprotocol/{core,server}/node_modules/zod/v4/…`. The generated identifiers
shift as a consequence (`process2`/`process4`, `failure3`/`failure`), which is exactly the noise this
produces.

### 3.2 The CI gate is a frozen-lockfile build

`.github/workflows/package-payload.yml` (triggered on `pull_request`):

```
bun install --frozen-lockfile
NODE_ENV=test bun run build
git diff --exit-code -- dist/
```

### 3.3 A clean, lockfile-faithful checkout of `origin/master` FAILS that gate

```
$ git worktree add /tmp/... origin/master --detach      # 2118b5a3
$ bun install                                           # nested zod resolves to 4.5.4; bun.lock unchanged
$ NODE_ENV=test bun run build
$ git hash-object dist/index.js
9e9a19eb32aca867773ff061a017271fb15b4fef                # fresh frozen-lockfile build
$ git rev-parse origin/master:dist/index.js
fc02ac28bef107e0fa8097a7b40a3e8c96cc316f                # what master actually commits
$ git diff --exit-code -- dist/ ; echo $?
1                                                        # the CI gate fails
```

**`origin/master` is therefore red on its own package-payload gate.** The drift went unnoticed because
`package-payload` triggers on `pull_request` only, never on `push`, so the direct `chore(release)`
commits that wrote `dist/` were never checked.

### 3.4 The lineage's `dist/` was correct all along

```
0e76b315:dist/index.js   bb67c91e3f75c7ebcb75af138493e6c37323703b   <- lineage
a23c79f5:dist/index.js   bb67c91e3f75c7ebcb75af138493e6c37323703b   <- reconciliation merge
frozen-lockfile build of the reconciled source
                         bb67c91e3f75c7ebcb75af138493e6c37323703b   <- identical
main-checkout build      4eca22d4933a0254fb6677c41748712364b75e4c   <- wrong host
```

The lineage's original worktree build is byte-identical to a frozen-lockfile build of the same source.
**The correction is to keep the lineage's `dist/` untouched.**

## 4. CI confirmation

PR #374's `payload-contract` and `packed-smoke` jobs failed on the main-checkout-built `dist/`, and the
failure diff is the identifier-shift noise described in §3.1. That is independent confirmation of this
finding from the gate itself rather than from a local reproduction.

## 5. Consequence for the migration

1. **Every N3 node that changes `src/` must rebuild `dist/` from a `bun install --frozen-lockfile`
   checkout**, not from the main checkout. A worktree with a fresh `bun install` is such a checkout;
   the main checkout currently is not.
2. **The main checkout's `node_modules` is drifted.** Until it is repaired, any build performed there
   produces an artifact CI will reject. Do not treat "built in the main checkout" as evidence of
   correctness. Treat "byte-identical to a frozen-lockfile build" as the evidence.
3. **Master's committed `dist/index.js` is out of compliance with master's own lockfile.** That is a
   pre-existing condition, not something this reconciliation introduced. It is repaired for this
   branch's tree, and it should be repaired on master independently.
4. Determinism must be checked against the same host class: two builds in the same checkout is the
   weaker test; a build equal to an independent frozen-lockfile checkout is the stronger one.

## 6. Status of the original claim

The unitAI-1pqtl conclusion was reached by comparing a worktree build against a main-checkout build and
observing a difference. The observation was correct; the inference about *which* was authoritative was
not. The difference was caused by dependency drift in the main checkout, not by a property of
worktrees. The closeout's own note that `89` committed a worktree blob `b53011a80393` and the release
commit replaced it with `fc02ac28bef1` is consistent with this: the "release" commit was built in a
drifted host.
