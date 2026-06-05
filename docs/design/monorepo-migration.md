# xtrm Monorepo Migration — Working Draft

> Status: exploration draft. Captures the git/worktree/packaging strategy for folding
> `xtrm-tools` (core), `specialists`, `substrate`, and `channels` into a single `xtrm`
> umbrella monorepo.
> Source of truth for the *design*: `docs/design/substrate/substrate-it-rev11.md`
> §"Layout del progetto" (the monorepo is already a committed design decision there).
> This doc covers the part the design is silent on: the git mechanics under a
> worktree-heavy workflow.

## 1. The monorepo is already decided

`substrate-it-rev11.md` §"Layout del progetto" commits to a five-package monorepo,
published as separate npm packages, importing each other in-repo:

| Package | Binary | Owns |
|---|---|---|
| **core** (ex `xtrm-tools`) | `xt` | bootstrap, **worktree management**, install/update/doctor |
| **substrate** | `sb` | issues, containers, plans, collisions, validator, memory |
| **channels** | lib (+ `ch`) | channel primitive — messages, subscriptions, reducer |
| **specialists** | `sp` | specialist run, job lifecycle, tether, telemetry |
| **console** | web app | dashboard (read-only) |

Acyclic dependency graph:
`console → {all}`; `specialists → {channels, substrate, core}`;
`substrate → {channels, core}`; `channels → {}`; `core → {}`.

Runtime: **one daemon, one store, one socket** — `~/.xtrm/state.db` (SQLite WAL).
Separation is **ownership-in-code, not file separation**; tables are namespaced per
domain; correlation by opaque ID, never cross-domain FK. (§13.1–13.2)

The open question this doc answers: **git history + worktree mechanics**, which the
design does not specify.

## 2. History strategy: preserve, do not nuke

A fresh `git init` is the wrong instinct. This repo (`specialists`) already *is* the
xtrm umbrella in everything but name — it carries the `.beads` board, `.claude/skills`,
`.xtrm/`, hooks, security pipeline, `docs/design/`, CI, branch protections, and the
`CHANGELOG`/blame archaeology. A fresh history throws all of that away for a cosmetic
clean `git log`.

**Decision: rename the GitHub repo `specialists` → `xtrm` and evolve in place.**
GitHub redirects the old URL; `origin` remotes keep resolving; issues/secrets/protections
survive. No new repo, no orphan branch.

Fresh history is only justified to (a) scrub secrets or (b) shrink a bloated `.git` —
and both have a better tool than nuking: `git filter-repo`.

## 3. The carve: two layers, not "move everything to packages/"

The current repo conflates two layers. Only the *package* layer moves.

| Layer | Examples | Destination |
|---|---|---|
| **Umbrella / harness** | `CLAUDE.md`, `.claude/skills`, `.xtrm/`, hooks, `.beads`, `.github`, `docs/design`, security configs, root `tsconfig` base | **stays at repo root** |
| **specialists package** | `src/`, `tests/`, `bin/sp`, `package.json`, `vitest.config.ts`, the `sp` runtime | **moves to `packages/specialists/`** |

Moving specialists' own code is a same-repo `git mv` — **history preserved for free**
(`git blame` / `git log --follow` track the rename, no filter-repo needed):

```bash
mkdir -p packages/specialists
git mv src packages/specialists/src
git mv tests packages/specialists/tests
git mv vitest.config.ts packages/specialists/
# carve package.json: root keeps workspace config + umbrella scripts;
# packages/specialists/package.json keeps runtime deps + the sp bin
```

## 4. Grafting core (xtrm-tools) with history

`core` is a separate existing repo and `xtrm-tools is huge`, so its history is worth
keeping. Bring it under `packages/core/` by rewriting then merging unrelated histories:

```bash
# on a throwaway clone of xtrm-tools
git filter-repo --to-subdirectory-filter packages/core

# back in the xtrm monorepo
git remote add core-src /path/to/xtrm-tools
git fetch core-src
git merge --allow-unrelated-histories core-src/main
git remote remove core-src
```

**Tag collision:** xtrm-tools `v1.x` tags will sit beside specialists `v3.17.0`.
Either drop imported tags or namespace them (`core/v1.2.3`); move to per-package tags
via changesets going forward.

### "Huge" splits into two cases — measure first

Run on the xtrm-tools clone:

```bash
du -sh .git
git rev-list --count HEAD
git rev-list --objects --all \
  | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' \
  | awk '/^blob/ {print $3/1048576" MB "$4}' | sort -rn | head -20
```

- **Case A — huge *depth*** (many commits, normal blobs): benign, graft as-is.
- **Case B — huge *bloat*** (committed `dist/`, binaries, vendored deps in history):
  graft **and scrub in the same pass** — keeps lineage, drops the junk:

```bash
git filter-repo \
  --to-subdirectory-filter packages/core \
  --strip-blobs-bigger-than 1M \
  --path dist --path node_modules --invert-paths
```

If top blobs are source → Case A. If `.dist`/binaries/lockfile-mountains → Case B.

`substrate` and `channels` are greenfield — `mkdir packages/{substrate,channels}`, no
history to preserve.

## 5. Sequencing — gated by the worktree fleet, not by difficulty

The landmine: the instant `src/` → `packages/specialists/src/`, **every open branch /
worktree based on the old layout conflicts catastrophically on rebase.** `git mv` is
cheap; reconciling in-flight branches across it is not. So the carve must happen when
the fleet is drained (`xt-merge` queue empty, no open worktree PRs).

1. **Now — zero disruption.** Rename repo → `xtrm`; enable bun workspaces with the root
   as a member (`bun.lock` already has the `workspaces` block, currently just `""`); add
   **`packages/channels`** greenfield and build channels v0 there. specialists (still at
   root) imports `@xtrm/channels` via `workspace:*`. Proves the plumbing on the lowest-risk
   leaf package, no carve, no rebase pain. (Channels is `→{}`, so it can't create cycles.)
2. **Conversion PR — fleet drained.** `git mv` specialists → `packages/specialists/`;
   graft `core` via filter-repo (Case A/B); namespace versions; introduce **changesets**;
   sweep hardcoded paths (skills, hooks, CI globs, GitNexus index, `tsconfig` refs all
   point at `src/`). One disruptive-but-mechanical PR in a quiet window.
3. **After — stable layout.** `packages/substrate`, then `packages/console`.

## 6. Worktrees under a (huge) monorepo

Worktrees are orthogonal to monorepo vs polyrepo: a worktree is a checkout of one
*branch* of the whole repo. Your `feature/<issue-id>-<slug>` rule, `xt claude`/`xt end`,
and the `xt-merge` FIFO queue are unchanged — they operate on branches, not packages.

Size impact is smaller than it feels:

- **History is shared across all worktrees** — same `.git` object store. A 500 MB `.git`
  is paid **once** at clone, amortized across every worktree. Worktree N adds zero history.
- **Per-worktree cost = working tree + `node_modules`**, both scopable (see §7).
- **Single daemon / single store** (`~/.xtrm/state.db`, one socket) is shared across all
  projects *and worktrees* — explicitly designed to kill the bd "9 servers" / "database
  not found in worktree" failures. The runtime is already worktree-aware.
- bd → substrate migration removes the `.beads/issues.jsonl`-churn-in-git problem.

The one real tax: **`node_modules` per worktree.** Two huge packages installed into every
worktree is where **pnpm** (global content-addressable store, hardlinks, near-free
per-worktree installs) may beat **bun**. Benchmark `bun install` vs `pnpm install` into a
fresh worktree once core + specialists are packages; let the number decide.

## 7. Sparse worktree bootstrap (scope a worktree to one package)

`sparse-checkout` config is **per-worktree** (`.git/worktrees/<name>/info/sparse-checkout`),
so each worktree can carry a different scope off the same object store. Use `--no-checkout`
so the full huge tree is never materialized.

```bash
git worktree add --no-checkout "$WT" "$BRANCH"
git -C "$WT" sparse-checkout init --cone
git -C "$WT" sparse-checkout set $SCOPE     # the magic line
git -C "$WT" checkout "$BRANCH"             # materializes only $SCOPE
```

Cone mode: **all top-level files come free** (`package.json`, `bunfig.toml`,
`tsconfig.base.json`, lockfile), but **top-level directories are excluded unless listed.**

`$SCOPE` must be **harness baseline + transitive workspace-dep closure**:

- **Baseline (always):** `.claude` `.xtrm` `config` `.beads` `docs` — the agent session
  needs skills/hooks/specialist defs.
- **Closure, not just the leaf:** `workspace:*` resolves to on-disk packages, so a
  `substrate` worktree that omits `channels`/`core` fails to build. Scope = the package's
  transitive workspace deps.

Savings track the DAG:

| Target | Closure | Savings |
|---|---|---|
| `channels` (`→{}`) | just channels | maximal |
| `core` (`→{}`) | just core | maximal |
| `substrate` (`→{channels,core}`) | + channels + core | partial |
| `specialists` (`→{channels,substrate,core}`) | nearly all but console | minimal |

Leaf packages win big; high-fan-out packages barely benefit. Channels (next work, zero-dep
leaf) is best case.

### Bootstrap sketch (real home is `xt`, which owns worktree management)

```bash
#!/usr/bin/env bash
# xt-worktree-add <branch> <target-package>
set -euo pipefail
BRANCH="$1"; PKG="$2"; WT=".worktrees/$BRANCH"

BASELINE=(.claude .xtrm config .beads docs)         # harness, always present

closure() {                                          # transitive workspace-dep dirs
  node scripts/workspace-closure.mjs "$PKG"          # or: pnpm list --filter "$PKG..." --depth -1
}
SCOPE=("packages/$PKG" $(closure "$PKG") "${BASELINE[@]}")

git worktree add --no-checkout "$WT" "$BRANCH"
git -C "$WT" sparse-checkout init --cone
git -C "$WT" sparse-checkout set "${SCOPE[@]}"
git -C "$WT" checkout "$BRANCH"

pnpm -C "$WT" install --filter "@xtrm/$PKG..."        # filtered install matches sparse scope
                                                      # bun: bun install --filter
```

The bead carries a package scope (substrate §6 issue schema), so `xt` can derive `$PKG`
automatically rather than passing it.

### Limits (honest)

- Sparse-checkout shrinks the **working tree**, not `.git` (history is shared anyway) —
  it's purely a working-tree + `node_modules` optimization, which is exactly the cost
  that mattered.
- Cross-package beads widen the closure **on purpose** — that's the atomic cross-package
  commit the monorepo exists to enable. Don't fight it; scope should track real blast radius.

## 8. Commits, PRs, versioning

- **Commits:** path-scoped conventional commits (`feat(channels):`, `fix(substrate):`).
  Let a single commit span packages only when the change is genuinely cross-cutting.
- **PRs:** one PR per bead-branch (unchanged). CI runs affected-package builds/tests only
  (`bun --filter` / turbo/nx `--filter ...[origin/main]`). Path-based CODEOWNERS per package.
- **Versioning (the one new discipline):** five packages, independent npm versions +
  changelogs. Use **changesets** — each PR declares which packages bump; it generates
  per-package CHANGELOGs/versions and tags (`channels@0.3.0`). The `/releasing` skill grows
  per-package awareness.

## 9. Open decisions

- **bun vs pnpm** — decided by the per-worktree `node_modules` benchmark (§6).
- **core history = Case A or B** — decided by the blob diagnostic (§4).
- **Tag handling for grafted core** — drop vs namespace (`core/vX`).
- **Path-sweep inventory** — enumerate every hardcoded `src/` reference (skills, hooks,
  CI, GitNexus, tsconfig) before the conversion PR.

## 10. Next actions

- [ ] Rename repo `specialists` → `xtrm` (GitHub).
- [ ] Enable bun workspaces (root-as-member) + scaffold `packages/channels`.
- [ ] Build channels v0 in `packages/channels`, specialists imports via `workspace:*`.
- [ ] Run blob diagnostic on xtrm-tools clone → classify Case A/B.
- [ ] Drain worktree fleet, then conversion PR (carve specialists, graft core, changesets,
      path sweep).
- [ ] Implement sparse worktree bootstrap in `xt` (`workspace-closure` + filtered install).
- [ ] Decide bun vs pnpm from benchmark.
- [ ] Add `packages/substrate`, `packages/console`.
