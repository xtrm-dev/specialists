# The Claude Code route as a user-scope switch (SPECIALISTS-4439)

Scoping document. It states how the route resolves today, what is broken or stale at this revision,
compares the user-scope shapes, and proposes one shape plus an implementation contract. It does not
implement the change and it does not edit any real HOME file.

Evidence rules: every claim about current behaviour cites `file:line`; the two probes were run
hermetically with a temporary `HOME` and `XDG_CONFIG_HOME` and their output is quoted.

## 1. Decision required

The operator wants the Claude Code route to be optional and off by default, selected once in
`~/.config/specialists/user.json`, without a per-specialist `~/.specialists/user/<name>.specialist.json`
copy on every machine ([OPERATOR RULING in the Issue, 2026-11-11]).

Open decision for the operator: the exact shape of the user-scope block (§6 has the proposal and §5
the alternatives) and two trust questions answered in §9.

## 2. How configuration resolves today

### 2.1 The layer order

The loader merges four layers, lowest to highest (`src/specialist/loader.ts:194-230`, applied in
`src/specialist/loader.ts:411-489`):

1. package canonical — `config/specialists/` in a checkout, or the installed package
   (`src/specialist/loader.ts:225-227`);
2. `~/.config/specialists/user.json` — sparse, override-allowed fields only
   (`src/specialist/loader.ts:454-467`);
3. `~/.specialists/user/<name>.specialist.json` — full spec, home layer
   (`src/specialist/loader.ts:189-192`, applied at `:469-489`);
4. `<repo>/.specialists/user/<name>.specialist.json` — full spec, repo layer
   (`src/specialist/loader.ts:216-219`, applied at `:469-489`).

Layers 3 and 4 are applied **after** layer 2, so they outrank the operator's `user.json` on every
field they set. Layer 2 is sparse: `null` or a missing key inherits
(`src/specialist/loader.ts:299-304`).

### 2.2 Where the model comes from

Every shipped definition under `config/specialists/` (25 files) carries **no** `execution.model`: the
operator's `user.json` is the only model source for those names. `SpecialistLoader.get` throws
`SpecialistMissingModelError` when the merged model is empty and points the operator at
`sp edit --global <name>.execution.model` (`src/specialist/loader.ts:83-92`, gate at
`src/specialist/loader.ts:585-590`).

So "the way shipped package definitions leave model fields to user settings" is already how models
work for the shipped set: the operator holds one model per Specialist in `user.json`. The bridge
route does not fit that pattern only because it also needs the per-Specialist selector.

### 2.3 How `claude_bridge` resolves

The route needs **both halves** (`docs/claude-bridge.md:16-39`):

- the definition selector `specialist.execution.claude_bridge === true`
  (`src/pi/claude-bridge.ts:46-48`; field declared at `src/specialist/schema.ts:50-59`, allowlisted
  for override layers at `src/specialist/schema.ts:189-203`);
- the operator switch `{ "claude_bridge": { "enabled": true } }` in `~/.config/specialists/user.json`
  (reader at `src/pi/claude-bridge.ts:62-78`; reserved key and strict schema at
  `src/specialist/global-config.ts:148-160`).

The route predicate is `definition && operator` (`src/pi/claude-bridge.ts:85-90`). It is evaluated
from the **merged** spec in the native host (`src/activation/native-host.ts:1852-1876`), again for a
retry (`src/activation/native-host.ts:3737-3739`), and again in the legacy argv path at session
start (`src/pi/session.ts:1548-1556`). All three entry points reach the same merged spec through
`SpecialistLoader.get` (`src/activation/native-host.ts:1240,1513`; `src/specialist/runner.ts:1178`;
`src/specialist/script-runner.ts:763`), so the loader is the one place a user-scope default can be
injected without the three runtimes drifting.

With the route on, the host names `claude-bridge` as an extension provider so the gate admits a
bridged model provisionally, then re-resolves the pattern on the live session and disposes the
session if the provider did not register (`docs/claude-bridge.md:182-191`;
`src/activation/native-host.ts:1867`, `:2373`).

### 2.4 What the owner layer can already express

`execution.claude_bridge` is an override-allowed field (`src/specialist/schema.ts:199`) and is present
in the global override schema (`src/specialist/global-config.ts:116`). The reserved switch key is
filtered out of the per-Specialist record before validation so one switch cannot invalidate every
override (`src/specialist/global-config.ts:189-197`; helper at `:64-68`).

Probe (hermetic `HOME`/`XDG_CONFIG_HOME`, `bun run src/index.ts`, this revision):

```
$ sp edit --global --set explorer.execution.claude_bridge true
✓ explorer.execution.claude_bridge = true (/tmp/…/xdg/specialists/user.json)
$ sp edit --global --set explorer.execution.model claude-bridge/claude-sonnet-5-5
✓ explorer.execution.model = claude-bridge/claude-sonnet-5-5 (/tmp/…/xdg/specialists/user.json)
```

Resulting entry: `{"model":"claude-bridge/claude-sonnet-5-5", …, "claude_bridge":true}`.

So the per-Specialist half **is** expressible in `user.json` at this revision, one entry at a time.
That is exactly the shape the operator rejects as a workflow: one entry per Specialist in the
operator's file (the shipped set alone is 25 names, and the operator's real file carries more), with
both the selector and the model written by hand in each.

## 3. Verified defects and stale statements at this revision

**D1 — the `sp edit --global` rejection is fixed; the docs still claim it.**
`docs/claude-bridge.md:38` says "`sp edit --global` rejects the field today (the global override
schema does not list it)" and `docs/authoring.md:112` documents the command as working. The code
now lists the field (`src/specialist/global-config.ts:116`) and a regression test asserts schema and
allowlist cannot drift (`tests/unit/specialist/override-claude-bridge.test.ts`). The probe above
confirms the command works. The docs must be corrected; the Issue PROBLEM statement inherits the
stale claim.

**D2 — the reserved switch itself is not editable through the CLI.**
`resolveGlobalPath` always parses the first segment as a Specialist name and validates the rest
against `GlobalSpecialistOverrideSchema` (`src/cli/edit.ts:646-676`); the reserved key is not in that
schema and is filtered out of the name list (`src/cli/edit.ts:761`,
`src/specialist/global-config.ts:64-68`).

```
$ sp edit --global claude_bridge.enabled true
Error: invalid global path "claude_bridge.enabled". Unknown segment "enabled".
  Available: beads_write_notes, execution, mandatory_rules, notes_mode, output_file, prompt, skills, stall_detection
```

Any proposal that puts operator intent in the reserved block must add a CLI path for it, or the
switch becomes hand-edited JSON.

**D3 — `sp init --global` misclassifies the reserved key.**
`mergeGlobalUserConfig` skips only `_`-prefixed keys (`src/specialist/global-config.ts:316-317`) and
keeps unknown names verbatim while reporting them as removed (`:326-331`).

```
$ sp init --global   # with { "claude_bridge": {"enabled": true, "specialists": ["reviewer"]} } present
! claude_bridge is no longer shipped but kept in file (remove manually if unwanted)
```

The key survives, but the message is wrong and invites the operator to delete their consent record.
The merge must filter `CLAUDE_BRIDGE_SWITCH_KEY` like `listGlobalSpecialistNames` and the record
schema already do.

**D4 — a repository layer outranks the operator's `user.json` for `model` and `claude_bridge`.**
Probe: `user.json` sets `explorer` to `{model: claude-bridge/claude-sonnet-5-5, claude_bridge: true}`;
`<project>/.specialists/user/explorer.specialist.json` sets
`{model: anthropic/claude-sonnet-4-6, claude_bridge: false}`. Merged result through
`SpecialistLoader.get`:

```
{ "model": "anthropic/claude-sonnet-4-6", "claude_bridge": false }
```

Consequences at this revision:

- a repository can **turn the route off** for a Specialist the operator enabled (denial);
- a repository can **redirect** the model of a Specialist whose definition flag it can write,
  including to a different `claude-bridge/...` model, once the machine switch is on;
- a repo-defined Specialist that becomes the merge base can **select the route itself** — the
  operator switch is machine-wide consent and the definition flag is repo-writable
  (`docs/claude-bridge.md:20-22` states this boundary).

The last point is the current trust model, not a bug: the machine switch consents to the route in
general. It is, however, weaker than "nothing a repository writes can turn the route on", and a
user-scope **allow list** can close it.

**D5 — the route is not reachable without one hand-written entry per Specialist, or a forbidden home copy.**
`user.json` at this revision carries `claude_bridge: {enabled: true}` and one Specialist (advisor)
carries the definition half in `~/.specialists/user/advisor.specialist.json`
(`execution.model: claude-bridge/claude-opus-5-5`, `execution.claude_bridge: true`). No other
Specialist can reach the route from the operator file without a per-name edit.

**D6 — operational observation, not a scoping finding: the route failed to admit on this host.**
A dispatch to `advisor` at this revision was refused with
`model_unavailable — the "claude-bridge" provider did not register on the session runtime … the
extension is installed but did not load its provider` (requested `claude-bridge/claude-opus-5-5`,
`pi-claude-bridge` 0.12.0 in `~/.pi/agent/npm/node_modules`), while a plain `pi --list-models` in the
same shell lists the `claude-bridge` provider and its models. That is a host/preflight problem with
the route, not with the switch shape; it needs its own Issue. It matters here only because any
migration must not assume the route currently works end to end.

## 4. What the proposal must satisfy

1. Off by default; optional; one file to remove consent from.
2. No per-specialist `~/.specialists/user/` copy, temporary or permanent.
3. Shipped definitions keep no `claude-bridge` primary and no model.
4. No repository layer can turn the route on, nor redirect a Specialist the operator selected.
5. One selection surface that the three runtimes and `sp list`/`sp view` all read.
6. A per-run model override keeps working (for example Opus for one run).
7. The existing no-fallback rule for bridged primaries is unchanged.
8. `sp edit --global` can write the switch, and `sp init --global` preserves it without noise.
9. The advisor home layer migrates to the new shape in one documented step.

## 5. Options

### Option A — extend the reserved `claude_bridge` block (recommended)

The reserved key becomes the operator's whole route selection: master switch, allow list, default
bridge model, per-name model map. It is applied **last** in the loader for exactly two fields
(`execution.claude_bridge`, `execution.model`), so it is authoritative over home and repo layers for
a listed Specialist.

- Pros: one file, one block; an explicit name list is the single consent surface; closes D4 for
  listed names; the loader is the one shared merge point, so native host, `sp run`, `sp script` and
  `sp list` cannot disagree; no new file format; the existing `enabled` key keeps its meaning.
- Cons: a precedence exception scoped to two fields (must be documented and tested); the definition
  flag becomes advisory when the list is present (a behaviour change for the advisor home layer
  until it is migrated); more schema surface on the reserved key.

### Option B — generic `_defaults` block in `user.json`

Reuse the `_` metadata sentinel for a default execution template applied to every Specialist.

- Pros: generalises beyond the bridge (a default model for all Specialists).
- Cons: `_` keys are metadata, filtered before validation (`src/specialist/global-config.ts:189-197`),
  so reusing one for semantics is a trap; a generic default model overrides shipped/operator choices
  for every Specialist (broad blast radius); it still needs the same precedence exception; and the
  bridge-specific trust question ("who may spend subscription quota") gets buried in a generic
  mechanism.

### Option C — a second operator file (or environment variables)

For example `~/.config/specialists/claude-bridge.json`, or `SPECIALISTS_CLAUDE_BRIDGE_ROUTE`.

- Pros: no schema churn in `user.json`; environment variables can be set per process.
- Cons: contradicts the operator's "one user-scope switch"; environment variables are inherited by
  child processes and by wrappers, so the consent record becomes ambient instead of a file the
  operator edits; a second file duplicates path/validation/init logic.

### Option D — model-driven selection only

Keep `{enabled}`, and treat "the merged model begins with `claude-bridge/`" as the selection.

- Pros: smallest code change; matches the "model lives in user.json" pattern.
- Cons: still one model line per Specialist (the workflow the operator rejected); and it is weaker
  than today: with a machine-wide switch, any repo layer that sets a bridged model would enable the
  route. Rejected on requirement 4.

## 6. Proposed shape (Option A)

```json
{
  "claude_bridge": {
    "enabled": true,
    "default_model": "claude-bridge/claude-sonnet-5-5",
    "specialists": ["advisor", "reviewer", "explorer"],
    "models": { "advisor": "claude-bridge/claude-opus-5-5" }
  }
}
```

### 6.1 Semantics

| Key | Meaning | Default |
| --- | --- | --- |
| `enabled` | master consent for the route on this machine; `false` disables it for every Specialist | `false` |
| `default_model` | bridge model for a listed Specialist that has no entry in `models` | absent |
| `specialists` | the allow list; explicit names that may use the route. No wildcard: consent names a Specialist, and a repo-defined name never gets it implicitly (§9, amendment 2) | absent |
| `models` | per-name bridge model; wins over `default_model` | absent |

Resolution for Specialist `N`, applied in the loader after every other layer:

1. `enabled !== true` → no injection; the route is off for every Specialist (unchanged kill switch).
2. `specialists` absent → legacy rule: the merged definition flag decides, and the operator switch
   is the machine gate. This keeps today's behaviour and makes the change a rollout, not a flag day.
   `sp doctor` reports the legacy shape as deprecated once the allow list exists.
3. `specialists` present (including `[]`) → the list is **authoritative both ways**: `N` listed gets
   `execution.claude_bridge = true` and `execution.model = models[N] ?? default_model`; `N` not
   listed gets `execution.claude_bridge = false` even if a home or repo layer set it. A listed `N`
   with no model in any layer therefore becomes runnable on `default_model`; a per-Specialist
   `execution.claude_bridge` entry in `user.json` becomes redundant, and `sp doctor` reports it as
   such rather than letting two operator surfaces disagree.
4. The injected model is a `claude-bridge/...` string, validated by the block's schema
   (`default_model` and every `models[*]` must start with `claude-bridge/`). No preset references:
   the block is bridge-specific, and a preset would hide which surface is billed.
5. A listed `N` that resolves to a non-bridged model is invalid input: schema validation refuses it
   at write time and `sp doctor` reports it for a hand-edited file. At dispatch the run is
   **refused** with a dedicated rejection code naming the Specialist, the resolved model and the
   `claude_bridge` block — never run inert, because loading the bridge and then billing another
   provider is the silent billing-surface swap the route exists to prevent (§9, Q4).
6. When the block changes a value a lower layer set (a home or repo layer asked for a different
   model or flag), the loader records a provenance warning that `sp doctor` and `sp list` can show,
   so the operator sees that their selection shadowed a layer rather than silently observing a
   different model (§9, amendment 1).

Invariants:

- `fallback_models` is not touched. A bridged primary already suppresses the walk
  (`src/pi/claude-bridge.ts:133-135`, `docs/claude-bridge.md:97-110`), so a fallback on a listed
  Specialist is inert; `sp doctor` warns and suggests removing it instead of silently rewriting it.
- An explicit `--model` override keeps today's meaning: it replaces the candidate chain for that run
  (`src/activation/native-host.ts:1831-1833`). It does not grant the route (see §9, Q2).
- Retry with a model override re-evaluates the route from the same merged spec
  (`src/activation/native-host.ts:3734-3739`), so a listed Specialist stays listed and an unlisted
  one stays refused.

### 6.2 One resolver, every runtime

The block is projected by one exported function in the loader module, for example
`resolveEffectiveClaudeBridge(execution, block, name)`, and every reader consumes its result — the
native host at dispatch and retry, the legacy runner, the script runner and the session. Do not
re-derive the precedence in the host: there are already five route readers (§2.3), and a host-only
implementation would drift from retry and the script surface, silently changing the model on a
retry (§9, Q1). The function returns the effective flag, the effective model and the reason, so a
refusal note can name the block instead of the definition flag.

### 6.3 Why the loader is the right placement

All three runtimes read the merged spec through `SpecialistLoader.get` (cites in §2.3), and
`sp list`/`sp view` read the same merge (`src/specialist/loader.ts:536-563`, model at `:549`). A
dispatch-time-only injection would need three copies and would leave the CLI view wrong. The loader
also already reads `user.json` for the sparse layer (`src/specialist/loader.ts:455-457`), so the
block adds no file read.

### 6.4 Validation and tooling

- The block keeps its own strict schema next to `ClaudeBridgeSwitchSchema`
  (`src/specialist/global-config.ts:158-160`); `validateGlobalUserConfig` must validate it in the
  same dedicated pass it already uses for the switch (`:438-447`), including the cross-field rule
  "a listed name must resolve to a bridged model".
- `listGlobalSpecialistNames` and `GlobalUserConfigSchema.preprocess` already filter the key
  (`:64-68`, `:189-197`); `mergeGlobalUserConfig` must do the same (D3).
- `sp edit --global` needs a reserved-key branch before the Specialist-name parse
  (`src/cli/edit.ts:646-676`): `sp edit --global claude_bridge.enabled true`,
  `… claude_bridge.specialists '["advisor","reviewer"]'`,
  `… claude_bridge.models.advisor claude-bridge/claude-opus-5-5`. `coerceGlobalValue` already
  handles booleans and arrays (`src/cli/edit.ts:678-711`).
- `sp init --global` preserves the block and seeds it only when absent, never overwriting an
  operator value (the merge already never clobbers; the defect is only the classification).
- `sp console` config view must not list the block as a Specialist (already true,
  `tests/unit/cli/console-config-view.test.ts:213-228`) and should render the selection read-only so
  an operator can see why a Specialist is bridged.

## 7. Trust boundary after the change

The switch remains exactly as trustworthy as the environment of the process that reads it: `HOME`
and `XDG_CONFIG_HOME` decide which `user.json` is read (`docs/claude-bridge.md:112-120`). The change
does not move the boundary; it moves the **decision** from "a machine-wide switch plus a
repo-writable definition flag" to "a machine-wide switch plus an operator-written name list", which
is strictly stronger:

- a repository cannot add a name to the list, so it cannot turn the route on;
- a repository cannot redirect the model of a listed name, because the block is applied last for
  `execution.model`;
- a repository can still set the definition flag, but for an unlisted name it has no effect (the block
  is authoritative); `sp doctor` hints at the ignored flag instead of silently dropping it;
- a repository keeps every other field of its own definition, which is the existing contract.

Residual risks to state in the docs:

- `XDG_CONFIG_HOME`/`HOME` inherited from untrusted content remains the way to substitute the file
  (unchanged, already documented). The blast radius grows because the block is now the sole consent
  surface, so keep the "stated, not enforced" wording prominent;
- a wildcard was considered and rejected: `"*"` plus a repo-defined Specialist (whose file becomes
  the merge base when no other layer holds that name, `src/specialist/loader.ts:423-442`) would run a
  repo-authored prompt on the operator's subscription with no name ever chosen (§9, Q5.1);
- the bridge package itself is resolved only from operator/user stores, never project scope
  (`docs/claude-bridge.md:59-82`).

## 8. Migration of the advisor home layer

Before (real HOME, read-only observation; not edited by this task):

```
~/.config/specialists/user.json
  "claude_bridge": { "enabled": true }

~/.specialists/user/advisor.specialist.json
  execution.model          = "claude-bridge/claude-opus-5-5"
  execution.claude_bridge  = true
```

After:

```
~/.config/specialists/user.json
  "claude_bridge": {
    "enabled": true,
    "default_model": "claude-bridge/claude-sonnet-5-5",
    "specialists": ["advisor"],
    "models": { "advisor": "claude-bridge/claude-opus-5-5" }
  }
```

and the two fields are removed from the advisor full spec. Advisor is a home-defined Specialist (it
is not shipped in `config/specialists/`), so its file stays as the merge base for prompt,
permission, thinking level and task template — only the route fields move. The operator performs
this edit; this task must not write to HOME.

Ordering matters for one release: if the allow list is introduced while the home layer still carries
the fields, the block is authoritative and `advisor` must be in the list, otherwise the route goes
off. Ship the migration note with the change and have `sp doctor` report "definition requests the
route but the operator allow list does not name it".

## 9. Second opinion (advisor Specialist, SPECIALISTS-4440)

Consulted read-only with five questions (§9.1). Its recommendation: adopt reserved-block selection
with three amendments, all adopted here. Its line references were not all exact; every citation in
this document was re-verified against the tree, and the advisor's evidence is restated below with
the verified locations.

### 9.1 Answers

**Q1 — precedence exception.** Acceptable. `execution.claude_bridge` and `execution.model` are
already override-allowable leaves and are not blocked fields (`src/specialist/schema.ts:189-203`,
`:234-243`), so the loader already treats both as layer-writable — that is the hole. A repo's
full-spec authority is over definition content (prompt, skills, tools), not over a consent record.
The safer implementation is one shared resolver in the loader, not host-level precedence, because
there are five route readers and a retry must see the same answer as dispatch.

**Q2 — `--model` as consent.** No. Argv is agent-emittable: a repo-authored prompt or a tool call
can cause a sub-dispatch carrying `--model claude-bridge/...`, and nothing distinguishes it from
operator input. The name list stays the single consent surface. For a listed Specialist the
override keeps today's meaning (chain replacement, `src/activation/native-host.ts:1831-1833`); for
an unlisted one the existing bridged-primary refusal fires
(`src/activation/native-host.ts:1870-1876`), and its note must be rewritten to name the allow list
instead of the definition flag.

**Q3 — collapsing the two halves.** Acceptable, and tighter where it matters: the definition flag is
repo-writable, so it never defended against a repository; it only expressed intent. The conjunction
(`src/pi/claude-bridge.ts:85-90`, re-checked at `src/pi/session.ts:1548-1556`) is preserved as
(master `enabled`, authoritative name list) with the per-Specialist half moved into the
non-repo-writable file. Keep the definition flag readable for diagnostics: a definition that asks
for the route while the list omits it is a doctor hint, not silence.

**Q4 — listed but non-bridged model.** Refusal, never inert. An inert grant loads the bridge, the
operator believes subscription billing applies, and the run bills another provider — exactly the
substitution the route forbids. A whole-file schema failure is disproportionate, since one bad
entry would fail closed for every Specialist. Use a dedicated refusal plus a doctor error.

**Q5 — other holes.**

1. `"*"` + a repo-defined name is the worst case: the repo file becomes the merge base and the
   wildcard grants the route on a repo-written prompt. Rejected with the wildcard.
2. `getGlobalUserConfigPath` prefers `XDG_CONFIG_HOME` (`src/specialist/global-config.ts:70-90`)
   while the home layer uses `process.env.HOME` (`src/specialist/loader.ts:168-175`). The block being
   the sole consent surface raises the cost of a wrapper that points XDG into a checkout.
3. Two readers, two failure modes: `operatorClaudeBridgeEnabled` swallows parse errors
   (`src/pi/claude-bridge.ts:62-78`) while the loader's sparse read throws on malformed JSON
   (`src/specialist/loader.ts:455-457`). The block must be read through the validated reader, and
   both surfaces must report the same structured error to `sp doctor`.
4. `specialists: []` versus absent must be stated in the schema documentation so `[]` is never read
   as "all".
5. `dist/` runtime: a source-only change is invisible to a running host until it is rebuilt and
   pulled (`docs/claude-bridge.md:162-164`).

### 9.2 Amendments adopted

1. One exported loader resolver consumed by all route readers, plus a provenance warning when the
   block shadows a differing layer (§6.2, §6.1 step 6).
2. Drop the wildcard; explicit names only (§6.1, §7).
3. Mismatch is a doctor error plus a dedicated dispatch refusal, not an inert grant (§6.1 step 5).

### 9.3 Premortem (advisor, adopted)

Top failure: the operator grants a wildcard for convenience and a repository ships a previously
unseen Specialist whose file becomes the merge base; the route then runs a repo-authored prompt on
the operator's login with no name ever chosen. Secondary: precedence is implemented in the host but
retry (`src/activation/native-host.ts:3734-3739`) or the script runner keeps reading only
`execution`, so a retry silently changes model with no error. Both are closed by amendments 1 and 2.

### 9.4 What would change the recommendation

If one resolver cannot become the only reader across host, retry, session, runner and script-runner
without touching all five, the loader mutation is too fragile; the alternative is a hard refusal
unless the merged model equals the block's model (today's fail-closed structure plus token-level
pinning instead of precedence). If fleet use genuinely requires the wildcard, restrict it to names
whose top layer is package scope.

## 10. Implementation contract (for operator approval)

**PROBLEM**
The Claude Code route needs two switches: the machine switch in `~/.config/specialists/user.json`
and a per-Specialist `execution.claude_bridge` plus `claude-bridge/...` model in a spec layer. At
this revision the per-Specialist half can be written in `user.json`, but only one Specialist entry at
a time, and a home or repo layer outranks it; for the shipped set alone the operator must hand-edit
25 entries, more for home-defined names (or keep the forbidden per-Specialist home copy). The reserved `claude_bridge` block cannot
be written through `sp edit --global`, and `sp init --global` reports it as an unshipped Specialist.

**SUCCESS**
- The reserved block accepts `enabled`, `default_model`, `specialists`, `models`; schema enforces
  that every selectable model is `claude-bridge/...`, that each listed name resolves to one, and that
  no wildcard is accepted.
- One exported loader resolver applies the block after every layer, authoritative both ways for
  `execution.claude_bridge` and `execution.model` when `specialists` is present; route off by
  default; legacy behaviour when the key is absent. Every route reader (native host dispatch and
  retry, `sp run`, `sp script`, session start) consumes that resolver.
- No repository layer can enable the route or redirect the model of a listed Specialist; a shadowed
  layer produces a provenance warning visible in `sp doctor` and `sp list`.
- Native host, `sp run`, `sp script`, `sp list`, `sp view` observe the same decision.
- A listed Specialist whose resolved model is not `claude-bridge/...` is refused with a dedicated
  rejection code naming the Specialist, the model and the `claude_bridge` block; the refusal is
  never an inert run.
- The bridged-primary refusal text names the operator allow list instead of the definition flag
  (`src/activation/native-host.ts:1870-1876`).
- `sp edit --global claude_bridge.*` writes the block; `sp init --global` preserves it without the
  "no longer shipped" message.
- `sp doctor` reports: legacy shape without an allow list; a listed Specialist whose merged model is
  not bridged; a definition flag on an unlisted Specialist; a bridged primary with fallbacks; a
  malformed block (structured error, same reader as the route decision).
- `docs/claude-bridge.md` and `docs/authoring.md` describe the new shape, correct the stale
  `sp edit --global` rejection claim, and state the trust boundary and no-fallback interaction.
- The advisor home layer is documented as migrated (operator performs it).

**SCOPE**
- `src/specialist/global-config.ts`, `src/specialist/schema.ts`, `src/specialist/loader.ts`,
  `src/pi/claude-bridge.ts`, `src/cli/edit.ts`, `src/cli/doctor.ts`, `src/cli/console/config-source.ts`
  (read-only projection), `docs/claude-bridge.md`, `docs/authoring.md`, `docs/overrides-guide.md`.
- Unit tests under `tests/unit/specialist/`, `tests/unit/cli/`, `tests/unit/pi/`.

**NON_GOALS**
- No change to the route's admission mechanics, the model gate carve-out, or the no-fallback rule
  beyond the refusal-note text.
- No shipped definition gains `claude_bridge` or `execution.model`.
- No wildcard entry, no `"*"` support.
- No edit to any real HOME file; no automatic migration of `~/.specialists/user/`.
- No new config file, no environment variable.
- No change to the sparse layer's throw-on-malformed-JSON behaviour; only the block reader is
  unified onto the validated read.
- No fix for D6 (the host-side provider registration failure); separate Issue.
- No release.

**CONSTRAINTS**
- The block is the only operator-side selector; a repository layer must never be able to enable it.
- Fail closed on absent, malformed or invalid block content (mirror
  `operatorClaudeBridgeEnabled`, `src/pi/claude-bridge.ts:62-78`).
- One shared predicate for the route decision; do not duplicate it per runtime.
- Precedence exception must be explicit in code and covered by a test that a repo layer cannot
  override a listed Specialist.
- Do not read credentials, `~/.pi/agent/models.json`, or `~/.claude` credentials.
- This repository runs `dist/`; the change is not live until it is rebuilt and pulled
  (`docs/claude-bridge.md:162-164`).

**VALIDATION**
- `bun run lint`; `bun run test` for the touched suites; `bun run build`.
- A hermetic test (`HOME`/`XDG_CONFIG_HOME` in a temp dir) proving: shipped Specialist + block list →
  bridged model and flag; repo layer setting a different model/flag → still the block's values, with
  the provenance warning; unlisted Specialist with a repo/home flag → route off; `enabled:false` →
  off for all; `specialists: []` → off for all; a `"*"` entry → schema rejection.
- A dispatch-level test proving retry and the script runner read the same resolver result, and that
  a listed Specialist with a non-bridged resolved model is refused with the dedicated code.
- A CLI test for `sp edit --global claude_bridge.*` and for `sp init --global` preserving the block
  without the removed-Specialist message.
- A doctor test for each new warning.
- Before commit: `node .gitnexus/run.cjs detect-changes --scope all --repo .`; impact analysis on
  `buildMergedSpec`, `validateGlobalUserConfig`, `resolveGlobalPath`.

**OUTPUT**
- The implementation PR plus updated docs; a Journal entry with validation output; the advisor
  migration note for the operator.

**SCRUTINY**
HIGH
