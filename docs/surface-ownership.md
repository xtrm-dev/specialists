# Surface Ownership and Precedence

> Canonical ownership map for specialist assets after layered refactor.

## Four-layer model

1. **Upstream source (package, read-only at runtime)**
   - `config/specialists/*.specialist.json`
   - `config/mandatory-rules/*`
   - `config/nodes/*.node.json`
2. **Optional managed/pinned mirror (repo, compatibility/pin layer)**
   - `.specialists/default/*.specialist.json`
   - `.specialists/default/mandatory-rules/*`
   - `.specialists/default/nodes/*.node.json`
   - Empty by default in fresh package-canonical installs; populated only for intentional pins or compatibility snapshots
3. **Repo authoring / custom layer (repo-owned)**
   - `.specialists/user/*.specialist.json`
   - `config/nodes/*.node.json` (repo node overrides)
4. **Runtime / generated state (never hand-author)**
   - `.specialists/jobs/`
   - `.specialists/ready/`
   - `.specialists/db/`

## Ownership boundaries

- `config/*` in package = canonical upstream source.
- `.specialists/default/*` = optional pin / compatibility snapshot. Prefer package-canonical fallback; prune stale defaults with `sp prune-stale-defaults`.
- `.specialists/user/*` = repo custom specialists. Safe place for overrides/forks.
- `.specialists/{jobs,ready,db}` = runtime state. Do not treat as config surface.

## Precedence ladders

### Specialists

Runtime loader order (first match wins):

1. `.specialists/user/`
2. `.specialists/default/`
3. `config/specialists/` (package fallback)
4. legacy paths (migration compatibility only)

Meaning:
- Same filename in `.specialists/user/` overrides mirror/package.
- New filename in `.specialists/user/` extends catalog.
- `.specialists/default/` can override package fallback for same name.

### Mandatory rules

Four-tier index resolution. Loader reads and union-merges all that exist (dedup by set id):

1. `.specialists/user/mandatory-rules/index.json` — repo-owned user overlay, highest priority
2. `config/mandatory-rules/index.json` — upstream source, ships with package
3. `.specialists/default/mandatory-rules/index.json` — optional pin / compatibility snapshot, pruned by `sp prune-stale-defaults` unless intentionally retained
4. `.specialists/mandatory-rules/index.json` — repo overlay, wins on set-id conflict

Set-file lookup (`<set-id>.md`) probes the same four paths in reverse precedence:
`.specialists/user/mandatory-rules/` first, then `.specialists/mandatory-rules/`, then `.specialists/default/mandatory-rules/`, then `config/mandatory-rules/`.

Injection merge order (within the resolved index):

1. required sets (union of all tiers)
2. default sets (union of all tiers)
3. specialist `mandatory_rules.template_sets`
4. specialist `mandatory_rules.inline_rules`

Global workflow block injected unless `mandatory_rules.disable_default_globals=true`.

Full authoring guide: [`config/mandatory-rules/README.md`](../config/mandatory-rules/README.md).

### Nodes

Node resolution order:

1. explicit path (`specialists node run ./path/to/file.node.json`)
2. `config/nodes/` (repo-owned override layer)
3. `.specialists/default/nodes/` (managed mirror fallback)

`specialists node list` discovery follows same repo-first then mirror order.

## Repo fork flow (`specialists edit`)

### Same-name override

Use when customizing existing specialist without new catalog name.

- Create/edit `.specialists/user/<name>.specialist.json`
- Name unchanged
- Loader picks user file first

### New-name fork

Use when creating variant specialist.

- `specialists edit <new-name> --fork-from <base-name>`
- Writes `.specialists/user/<new-name>.specialist.json`
- New specialist appears alongside base

## Init, prune, and sync behavior

`specialists init` always:
- ensures `.specialists/user`, `.specialists/jobs`, `.specialists/ready`, `.specialists/db`
- wires hooks, MCP, skill symlinks

Package-canonical runtime assets are read from the installed package when no repo override exists. Fresh repos should normally leave `.specialists/default/` empty.

`specialists init --sync-defaults` still exists for compatibility, but it is deprecated because it creates default snapshots that drift. Use it only when an operator deliberately wants a repo-local pin/compatibility mirror.

Preferred cleanup:
- `sp doctor --check-drift` — report stale Category A defaults
- `sp prune-stale-defaults --dry-run` — preview removals
- `sp prune-stale-defaults` — remove stale defaults, including diverged defaults by default
- `sp prune-stale-defaults --keep-diverged` — preserve intentionally diverged defaults

## Migration notes

Legacy layouts still recognized for compatibility:
- `.specialists/user/specialists/*.specialist.json`
- `.specialists/default/specialists/*.specialist.json`

Migration target:
- `.specialists/user/*.specialist.json`
- `.specialists/default/*.specialist.json`

Operator rule:
- do not hand-edit `.specialists/default/*`
- edit in `.specialists/user/*` for repo custom behavior
- run `sp doctor --check-drift` and `sp prune-stale-defaults` to reconcile default mirror drift

## Explicit non-goal: backlog-clean isolation

This ownership/precedence migration does **not** change backlog-clean surfaces.

Untouched by this contract:
- backlog-clean command behavior
- backlog-clean data model
- backlog-clean runtime hooks/automation

Keep backlog-clean work isolated in dedicated issues/tasks.