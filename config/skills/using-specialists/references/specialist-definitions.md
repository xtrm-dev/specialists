# Specialist definitions

Use when adding, inspecting, or changing a Specialist definition against the current
Specialists schema and installed runtime. This advanced authoring material belongs under
`/using-specialists`; it is not a separate default skill.

Start from live truth:

```bash
specialists list --full
sp help
pi --list-models
```

When a field or behavior matters, inspect the current schema/runtime and the resolved
configuration:

- `src/specialist/schema.ts` — accepted definition shape;
- `src/specialist/runner.ts` and session/runtime code — execution semantics;
- `sp config show <name> --resolved` — effective definition after overlays.

Authoring flow:

1. define the role boundary, including when and when not to choose it;
2. reuse an existing role when only prompt wording differs;
3. scaffold/repair the definition with the bundled deterministic helper when useful;
4. make narrow changes through current `sp edit` surfaces where practical;
5. validate against the actual schema;
6. inspect the resolved runtime view;
7. decide the capability tier AND whether the role needs a workspace lease (see below — a
   read-tier role that must run its own commands does);
8. smoke the role on a representative bounded task.

Bundled helpers live under `scripts/specialist-definitions/`:

```bash
bun scripts/specialist-definitions/scaffold-specialist.ts <file>
bun scripts/specialist-definitions/validate-specialist.ts <file>
node scripts/specialist-definitions/audit-spec-uniformity.mjs
```

Select only models reported by the current Pi/runtime inventory. Grant the least capability
that can complete the role. Shared XTRM work-contract, coordination and safety doctrine
belongs to XTRM-owned surfaces rather than duplicated in every Specialist prompt.

## Capability tiers and the workspace lease

`execution.permission_required` selects the tool grant; the workspace lease is a separate
fact. A `MEDIUM` or `HIGH` specialist resolves to `access: "write"`, is provisioned an
isolated per-Issue worktree and MUST acquire that worktree's lease before an AgentSession
exists. Every other tier runs `access: "read"`, acquires nothing, and is refused EVERY
`bash` call by admission — the tier grant alone does not make a shell usable.

That matters when authoring a self-sampling observer: a watcher, a durable monitor, a
reviewer or any read-tier role whose job is to run its own commands (`docker ps`, `mcpq`,
`git fetch`, a test runner) rather than to read artifacts someone else collected. Handing
such a role pre-collected evidence is not the role; the role is the sampling.

Declare `execution.lease_waiver: true` for it. The specialist then provisions its own
isolated per-Issue worktree and acquires that lease despite the read tier, so its `bash` is
admitted there. The one-writer invariant holds per workspace: no other activation ever uses
that worktree. This is not an admission carve-out — unlike the permission guard, which may
admit READ_ONLY `bash` because bwrap proves each call harmless, raw `bash` cannot prove
anything, so isolation carries the guarantee instead.

Rules of use:

- Set it only on roles that must sample live state themselves. A role that reads worktree
  files, an injected diff, or MCP extension tools needs no waiver and should not have one.
- The waiver admits ALL `bash` inside the isolated worktree, so production-read-only
  remains a prompt-level constraint. State the prohibitions in the prompt explicitly; do
  not assume the tier enforces them.
- `READ_ONLY` + waiver is coherent (read tools plus admitted `bash`); `LOW` + waiver is the
  common observer shape; `MEDIUM`/`HIGH` are already write-tier, so the flag there only
  records intent.
- Settable per user in `~/.config/specialists/user.json` (`execution.lease_waiver`); any
  other override path ignores it, so a sparse override cannot waive a shipped definition.
- Visible where an operator looks: `sp list --full` prints `[worktree:auto+waiver]`, registry
  rows carry `lease_waiver: true`, and a live activation projects the same flag.

A definition is ready only when schema validation passes, resolved config shows the
intended tools/model/skills/permissions, referenced dependencies exist, and a representative
smoke produces the expected output contract.

## Bare-mode invariant

`execution.bare: true` removes ordinary Specialist framing, default rules, and specialist-selected rules, but it does **not** remove package `required_template_sets`. Bare workers are still XTRM system participants and always receive the fleet boundary.
